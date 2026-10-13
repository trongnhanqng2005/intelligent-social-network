param(
  [Parameter(Mandatory = $true)][ValidateSet('Start', 'Stop')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Root
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$scriptPath = [IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)
$stateDirectory = Join-Path $Root '.artifacts/local-dev-launcher'
$statePath = Join-Path $stateDirectory 'launcher.json'
$stopPath = Join-Path $stateDirectory 'stop.request'
$rootHash = [Security.Cryptography.SHA256]::Create()
try { $rootHashText = [BitConverter]::ToString($rootHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Root.ToLowerInvariant()))).Replace('-', '') }
finally { $rootHash.Dispose() }
$mutexName = 'Local\ISNDevLauncher_' + $rootHashText.Substring(0, 24)

function Get-LauncherState {
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { return $null }
  try { return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json }
  catch { throw "Launcher state is unreadable at $statePath. No process was stopped." }
}

function Get-VerifiedSupervisor($state) {
  if (-not $state -or [int]$state.pid -le 0) { throw 'No valid launcher state was found. No process was stopped.' }
  if (-not $state.root -or [IO.Path]::GetFullPath([string]$state.root) -ne $Root) {
    throw 'Launcher state belongs to a different repository. No process was stopped.'
  }
  try { $process = Get-Process -Id ([int]$state.pid) -ErrorAction Stop }
  catch { throw "Launcher state is stale (PID $($state.pid) is not running). No process was stopped." }
  if ($process.StartTime.ToUniversalTime().Ticks -ne [long]$state.startedUtcTicks) {
    throw 'Launcher state is stale (PID was reused). No process was stopped.'
  }
  $details = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$state.pid)" -ErrorAction Stop
  $commandLine = [string]$details.CommandLine
  if (-not $commandLine -or $commandLine.IndexOf($scriptPath, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
      $commandLine.IndexOf('-Action Start', [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
      $commandLine.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw 'Launcher state does not identify this repository supervisor. No process was stopped.'
  }
  return $process
}

function Test-StopRequested {
  if (-not (Test-Path -LiteralPath $stopPath -PathType Leaf)) { return $false }
  try {
    $requestedToken = [IO.File]::ReadAllText($stopPath).TrimStart([char]0xfeff).Trim()
    return $requestedToken -eq $stateToken
  } catch { return $false }
}

if ($Action -eq 'Stop') {
  try {
    $state = Get-LauncherState
    if (-not $state) { Write-Host 'Local development launcher is not running.'; exit 0 }
    $null = Get-VerifiedSupervisor $state
    [IO.File]::WriteAllText($stopPath, [string]$state.token, [Text.Encoding]::UTF8)
    Write-Host 'Stop requested for this repository launcher. Waiting for its owned application processes to exit...'
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $deadline) {
      Start-Sleep -Milliseconds 250
      try { $null = Get-VerifiedSupervisor $state }
      catch { Write-Host 'Launcher stopped; its owned application processes have been closed.'; exit 0 }
    }
    throw "Launcher did not stop within 20 seconds. Check its logs under $stateDirectory. No unrelated process was terminated."
  } catch {
    Write-Host "Stop failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
}

New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$mutex = [Threading.Mutex]::new($false, $mutexName)
$ownsMutex = $false
$jobHandle = [IntPtr]::Zero
$apiProcess = $null
$webProcess = $null
$stateToken = [Guid]::NewGuid().ToString('N')
$stateWritten = $false
$failed = $false
$logStamp = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + "-$PID"
$launcherLog = Join-Path $stateDirectory "launcher-$logStamp.log"
$apiLog = Join-Path $stateDirectory "api-$logStamp.log"
$webLog = Join-Path $stateDirectory "web-$logStamp.log"
$transcriptStarted = $false

try {
  Start-Transcript -Path $launcherLog -Force | Out-Null
  $transcriptStarted = $true
  try { $ownsMutex = $mutex.WaitOne(0) }
  catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) {
    Write-Host 'A launcher for this repository is already starting or running. No duplicate servers were started.' -ForegroundColor Yellow
    exit 0
  }

  Set-Location -LiteralPath $Root
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $nodeVersion = (& $node --version).Trim().TrimStart('v')
  $npmVersion = (& $npm --version).Trim()
  if ([version]$nodeVersion -lt [version]'24.15.0' -or [version]$nodeVersion -ge [version]'25.0.0') {
    throw "Node.js 24.15.x or later in the 24.x line is required; found $nodeVersion."
  }
  if ([version]$npmVersion -lt [version]'11.19.0' -or [version]$npmVersion -ge [version]'12.0.0') {
    throw "npm 11.19.x or later in the 11.x line is required; found $npmVersion."
  }
  $configJson = & $node (Join-Path $Root 'scripts/dev-config.mjs') --json
  if ($LASTEXITCODE -ne 0) { throw 'Development configuration preflight failed. Review the message above; secret values are never printed.' }
  $config = ($configJson -join "`n") | ConvertFrom-Json
  Write-Host "Configuration verified for Neo4j database $($config.database)."

  $ports = @([int]$config.apiPort, [int]$config.webPort) | Select-Object -Unique
  foreach ($port in $ports) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) { throw "Port $port is already in use by PID $($listener.OwningProcess). Close that application yourself and retry; it was not stopped." }
  }

  $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
  $cmdPath = Join-Path $env:SystemRoot 'System32/cmd.exe'
  $nativeSource = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DevLauncherNative {
  [StructLayout(LayoutKind.Sequential)] public struct BasicLimit { public long PerProcessTime, PerJobTime; public uint LimitFlags; public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] public struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
  [StructLayout(LayoutKind.Sequential)] public struct ExtendedLimit { public BasicLimit BasicLimitInformation; public IoCounters IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct StartupInfo { public uint cb; public string lpReserved, lpDesktop, lpTitle; public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] public struct ProcessInfo { public IntPtr hProcess, hThread; public uint processId, threadId; }
  [StructLayout(LayoutKind.Sequential)] public struct SecurityAttributes { public int nLength; public IntPtr lpSecurityDescriptor; public bool bInheritHandle; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr attrs, string name);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimit info, uint length);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CreateProcess(string app, StringBuilder command, IntPtr procAttrs, IntPtr threadAttrs, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo startup, out ProcessInfo info);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr process, uint code);
  public static IntPtr NewKillOnCloseJob() {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    ExtendedLimit limits = new ExtendedLimit(); limits.BasicLimitInformation.LimitFlags = 0x2000;
    if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimit)))) { CloseHandle(job); throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
    return job;
  }
  public static ProcessInfo StartSuspended(IntPtr job, string app, string command, string cwd) {
    StartupInfo startup = new StartupInfo(); startup.cb = (uint)Marshal.SizeOf(typeof(StartupInfo));
    ProcessInfo info; StringBuilder mutable = new StringBuilder(command);
    if (!CreateProcess(app, mutable, IntPtr.Zero, IntPtr.Zero, true, 0x00000004, IntPtr.Zero, cwd, ref startup, out info)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    if (!AssignProcessToJobObject(job, info.hProcess)) { int error = Marshal.GetLastWin32Error(); TerminateProcess(info.hProcess, 1); CloseHandle(info.hThread); CloseHandle(info.hProcess); throw new System.ComponentModel.Win32Exception(error); }
    if (ResumeThread(info.hThread) == 0xffffffff) { TerminateJobObject(job, 1); CloseHandle(info.hThread); CloseHandle(info.hProcess); throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
    CloseHandle(info.hThread); return info;
  }
}
'@
  Add-Type -TypeDefinition $nativeSource -ErrorAction Stop
  $jobHandle = [DevLauncherNative]::NewKillOnCloseJob()

  $state = [ordered]@{ pid = $PID; startedUtcTicks = (Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks; root = $Root; token = $stateToken; apiLog = $apiLog; webLog = $webLog }
  $tempState = "$statePath.tmp"
  [IO.File]::WriteAllText($tempState, ($state | ConvertTo-Json -Compress), [Text.Encoding]::UTF8)
  Move-Item -LiteralPath $tempState -Destination $statePath -Force
  $stateWritten = $true

  $startOwnedProcess = {
    param([string]$scriptName, [string]$logPath)
    $command = '"' + $cmdPath + '" /d /s /c ""' + $npmPath + '" run ' + $scriptName + ' >> "' + $logPath + '" 2>&1"'
    $info = [DevLauncherNative]::StartSuspended($jobHandle, $cmdPath, $command, $Root)
    return [pscustomobject]@{ Handle = $info.hProcess; Pid = $info.processId; Log = $logPath; Offset = [long]0 }
  }
  $readLog = {
    param($owned)
    if (-not (Test-Path -LiteralPath $owned.Log)) { return }
    $stream = [IO.File]::Open($owned.Log, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      if ($stream.Length -lt $owned.Offset) { $owned.Offset = 0 }
      $stream.Position = $owned.Offset
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true, 1024, $true)
      $text = $reader.ReadToEnd()
      $owned.Offset = $stream.Position
      foreach ($line in ($text -split "`r?`n")) { if ($line) { Write-Host $line } }
    } finally { $stream.Dispose() }
  }
  $checkAlive = {
    param($owned)
    [uint32]$code = 0
    if ([DevLauncherNative]::WaitForSingleObject($owned.Handle, 0) -ne 258) {
      [void][DevLauncherNative]::GetExitCodeProcess($owned.Handle, [ref]$code)
      throw "$($owned.Log.Split([IO.Path]::DirectorySeparatorChar)[-1]) process exited during startup/runtime (exit code $code). See $($owned.Log)."
    }
  }
  $probeHttp = {
    param([string]$url)
    $request = [Net.HttpWebRequest]::Create($url)
    $request.Timeout = 3000
    $response = $null
    try { $response = $request.GetResponse() }
    catch [Net.WebException] { $response = $_.Exception.Response; if (-not $response) { return $null } }
    try {
      $reader = [IO.StreamReader]::new($response.GetResponseStream())
      try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
      $payload = $body
      try { $payload = $body | ConvertFrom-Json } catch { }
      return [pscustomobject]@{ StatusCode = [int]$response.StatusCode; Payload = $payload }
    } finally { $response.Close() }
  }
  $waitForReady = {
    param([string]$url, [string]$stage, [scriptblock]$validResponse, $owned)
    $until = [DateTime]::UtcNow.AddSeconds(90)
    $lastFailure = 'no HTTP response yet'
    $lastReason = ''
    while ([DateTime]::UtcNow -lt $until) {
      if (Test-StopRequested) { throw [OperationCanceledException]::new('Startup was cancelled by stop-dev.cmd.') }
      & $checkAlive $owned
      & $readLog $owned
      try {
        $probe = & $probeHttp $url
        if ($probe) {
          if ($probe.StatusCode -ge 200 -and $probe.StatusCode -lt 300 -and (& $validResponse $probe.Payload)) {
            Write-Host "$stage is ready: $url" -ForegroundColor Green
            return
          }
          $reason = if ($probe.Payload.status -eq 'not_ready' -and $probe.Payload.reason) { [string]$probe.Payload.reason } else { "HTTP $($probe.StatusCode)" }
          $lastFailure = $reason
          if ($reason -ne $lastReason) { Write-Host "$stage is waiting: $reason" -ForegroundColor Yellow; $lastReason = $reason }
        }
      } catch { }
      Start-Sleep -Seconds 2
    }
    throw "$stage did not become ready within 90 seconds (last response: $lastFailure). See $($owned.Log)."
  }

  Write-Host "Starting API with npm run dev:api; log: $apiLog"
  $apiProcess = & $startOwnedProcess 'dev:api' $apiLog
  $apiReady = { param($response) $response.status -eq 'ready' -and $response.database -eq 'isn-dev' }
  & $waitForReady $config.apiProbeUrl 'API and Neo4j/schema' $apiReady $apiProcess

  Write-Host "Starting frontend with npm run dev:web; log: $webLog"
  $webProcess = & $startOwnedProcess 'dev:web' $webLog
  $frontendUrl = "$($config.webUrl)/"
  $webReady = { param($response) $true }
  & $waitForReady $frontendUrl 'Frontend HTTP' $webReady $webProcess
  $proxyUrl = "$($config.webUrl)/api/ready"
  & $waitForReady $proxyUrl 'Frontend API proxy' $apiReady $webProcess

  Start-Process $config.webUrl
  Write-Host "Application opened in the default browser: $($config.webUrl)" -ForegroundColor Green
  Write-Host "Keep this console open. Application logs: $stateDirectory"
  Write-Host 'Run scripts/stop-dev.cmd to stop only this launcher and its application processes.'

  while ($true) {
    if (Test-StopRequested) { break }
    & $checkAlive $apiProcess
    & $checkAlive $webProcess
    & $readLog $apiProcess
    & $readLog $webProcess
    Start-Sleep -Seconds 1
  }
  Write-Host 'Stopping launcher-owned API and frontend processes...'
} catch {
  if ($_.Exception -is [OperationCanceledException]) {
    Write-Host 'Startup cancelled by stop-dev.cmd; closing only launcher-owned processes.' -ForegroundColor Yellow
  } else {
    Write-Host "Launcher failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Diagnostics retained under: $stateDirectory"
    Write-Host "Launcher log: $launcherLog"
    if (Test-Path -LiteralPath $apiLog) { Write-Host "API log: $apiLog" }
    if (Test-Path -LiteralPath $webLog) { Write-Host "Frontend log: $webLog" }
    $failed = $true
  }
} finally {
  if ($jobHandle -ne [IntPtr]::Zero) {
    [void][DevLauncherNative]::CloseHandle($jobHandle)
    $jobHandle = [IntPtr]::Zero
  }
  if ($stateWritten) {
    try {
      $currentState = Get-LauncherState
      if ($currentState -and $currentState.token -eq $stateToken) { Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue }
    } catch { }
    Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue
  }
  if ($apiProcess) { [void][DevLauncherNative]::CloseHandle($apiProcess.Handle) }
  if ($webProcess) { [void][DevLauncherNative]::CloseHandle($webProcess.Handle) }
  if ($transcriptStarted) { Stop-Transcript | Out-Null }
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
if ($failed) { exit 1 }
