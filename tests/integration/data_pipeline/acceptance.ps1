[CmdletBinding()]
param(
    [string]$ArtifactBase = 'D:\temp\opencode',
    [string]$VariantFixtureRoot = 'D:\temp\opencode\isn-b-etl-acceptance-20261014-01\fixtures\variants',
    [string]$HistoricalBaseline = 'D:\temp\opencode\isn-b-etl-acceptance-20261014-01\baseline\before.json',
    [string]$Image = 'isn-b-data-pipeline:py3.12-pyspark3.5.9-runtime-snappy',
    [string]$DoctorEvidencePath = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'acceptance_resource_gate.ps1')
. (Join-Path $PSScriptRoot 'acceptance_doctor_evidence.ps1')
. (Join-Path $PSScriptRoot 'acceptance_docker_monitoring.ps1')
$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$launcher = Join-Path $repo 'scripts\data-pipeline.ps1'
$fixtureDir = Join-Path $repo 'tests\fixtures\data_pipeline'
$expectedPath = Join-Path $fixtureDir 'acceptance-edges.expected.json'
$templateManifestPath = Join-Path $fixtureDir 'acceptance-edges.manifest.json'
$invocationId = [guid]::NewGuid().ToString('N')
$root = Join-Path $ArtifactBase "isn-b-etl-scenario-$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))-$invocationId"
$commands = [System.Collections.Generic.List[object]]::new()
$containers = [System.Collections.Generic.List[object]]::new()
$monitoringIssues = [System.Collections.Generic.List[object]]::new()
$stoppedSnapshots = [System.Collections.Generic.List[object]]::new()
$caseResults = [System.Collections.Generic.List[object]]::new()
$runtimeBefore = $null
$minimumHostFreeBytes = [long]4831838208
$doctorPostflight = $null
$doctorOutcome = $null
$doctorReuseOutcome = $null
$doctorValidation = $null
$doctorSourceFingerprints = @()
$doctorRuntimeDependencies = [pscustomobject]@{ python = '3.12.15'; pyspark = '3.5.9'; py4j = '0.10.9.7'; java = '17.0.20.1'; spark = '3.5.9'; master = 'local[2]' }
$doctorLimits = [pscustomobject]@{ cpus = 2; memory_bytes = [long]4294967296; pids_limit = 256; network = 'none' }
$etl00Status = 'NOT VERIFIED'
$sparkLaunchMeasurements = [System.Collections.Generic.List[object]]::new()
$failureStatus = 'FAILED'

function Write-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][object]$Value)
    $json = ConvertTo-Json -InputObject $Value -Depth 30
    [System.IO.File]::WriteAllText($Path, $json + "`n", [System.Text.UTF8Encoding]::new($false))
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false, $true))
    return ConvertFrom-Json -InputObject $text
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TreeSnapshot {
    param([Parameter(Mandatory = $true)][string]$Path)
    $items = @()
    if (Test-Path -LiteralPath $Path) {
        foreach ($file in Get-ChildItem -LiteralPath $Path -Recurse -File) {
            $items += [pscustomobject]@{
                relative_path = $file.FullName.Substring($Path.Length).TrimStart('\', '/')
                bytes = $file.Length
                sha256 = Get-Sha256 -Path $file.FullName
            }
        }
    }
    return @($items | Sort-Object relative_path)
}

function Get-DockerContainerState {
    param([Parameter(Mandatory = $true)][string]$ContainerId)
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& docker inspect --format '{{.State.Status}}' $ContainerId 2>&1)
        $exitCode = $LASTEXITCODE
    } catch {
        $output = @($_.Exception.Message)
        $exitCode = 1
    } finally { $ErrorActionPreference = $previousPreference }
    $text = (@($output | ForEach-Object { [string]$_ }) -join "`n").Trim()
    if ($exitCode -eq 0 -and $text -in @('created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead')) {
        return [pscustomobject]@{ state = $text; exit_code = 0; output = $text }
    }
    if ($text -match '(?i)(no such (object|container)|not found)') { return [pscustomobject]@{ state = 'missing'; exit_code = $exitCode; output = $text } }
    return [pscustomobject]@{ state = 'unknown'; exit_code = $exitCode; output = $text }
}

function Add-DockerMonitoringIssue {
    param([string]$CommandId, [string]$Operation, [object]$Result, [string]$ContainerId)
    if ($Result.status -eq 'PASS') { return }
    $monitoringIssues.Add([pscustomobject]@{
        command_id = $CommandId
        operation = $Operation
        container_id = $ContainerId
        status = $Result.status
        exit_code = $Result.exit_code
        combined_output = ConvertTo-SanitizedText ([string]$Result.combined_output)
        container_state_after_failure = $Result.container_state_after_failure
        reason = $Result.reason
        captured_at_utc = [DateTime]::UtcNow.ToString('o')
    })
}

function Add-DockerMonitoringException {
    param([string]$CommandId, [string]$Operation, [string]$ContainerId, [string]$Message)
    $state = if ($ContainerId) { (Get-DockerContainerState -ContainerId $ContainerId).state } else { 'unknown' }
    $result = Resolve-DockerStatsResult -ExitCode 1 -CombinedOutput $Message -ContainerStateAfterFailure $state
    if ($result.status -eq 'BENIGN_TEARDOWN_RACE') {
        $result.reason = "Confirmed container teardown raced with '$Operation'."
    } else {
        $result.status = 'FAILED'
        $result.reason = "Docker monitoring operation '$Operation' threw before it completed: $Message"
    }
    Add-DockerMonitoringIssue -CommandId $CommandId -Operation $Operation -ContainerId $ContainerId -Result $result
}

function ConvertTo-SanitizedText {
    param([AllowEmptyString()][string]$Text)
    if ($null -eq $Text) { return '' }
    $value = $Text
    if ($env:USERPROFILE) {
        $value = $value.Replace($env:USERPROFILE, '<USER_HOME>')
    }
    $value = $value.Replace($repo, '<REPOSITORY>').Replace($root, '<ACCEPTANCE_ROOT>')
    $value = [regex]::Replace($value, '(?i)(password|secret|token|credential)(\s*[=:]\s*)[^\s"'']+', '$1$2<REDACTED>')
    return $value
}

function ConvertTo-ProcessArgument {
    param([AllowEmptyString()][string]$Value)
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Get-ContainerSnapshot {
    param([Parameter(Mandatory = $true)][string]$CommandId)
    $filter = "label=org.weylume.isn-etl.invocation=$invocationId"
    $commandFilter = "label=org.weylume.isn-etl.command=$CommandId"
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $psOutput = @(& docker ps -q --filter $filter --filter $commandFilter 2>&1)
        $psExitCode = $LASTEXITCODE
    } catch { $psOutput = @($_.Exception.Message); $psExitCode = 1 }
    finally { $ErrorActionPreference = $previousPreference }
    if ($psExitCode -ne 0) {
        $psText = (@($psOutput | ForEach-Object { [string]$_ }) -join "`n").Trim()
        Add-DockerMonitoringIssue -CommandId $CommandId -Operation 'docker ps' -ContainerId '' -Result ([pscustomobject]@{
            status = 'FAILED'; exit_code = $psExitCode; combined_output = $psText; container_state_after_failure = 'unknown'; reason = "docker ps failed with exit code $psExitCode."
        })
        return
    }
    $ids = @($psOutput | ForEach-Object { [string]$_ } | Where-Object { $_ -match '^[a-fA-F0-9]{12,64}$' })
    foreach ($containerId in $ids) {
        if (-not $containerId) { continue }
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $json = & docker inspect $containerId 2>&1
            $inspectExitCode = $LASTEXITCODE
        } catch { $json = @($_.Exception.Message); $inspectExitCode = 1 }
        finally { $ErrorActionPreference = $previousPreference }
        if ($inspectExitCode -ne 0) {
            $inspectText = (@($json | ForEach-Object { [string]$_ }) -join "`n").Trim()
            $stateAfter = Get-DockerContainerState -ContainerId $containerId
            $state = if ($stateAfter.state -in @('missing', 'exited', 'dead', 'removing')) { $stateAfter.state } else { 'unknown' }
            $classification = Resolve-DockerStatsResult -ExitCode $inspectExitCode -CombinedOutput $inspectText -ContainerStateAfterFailure $state
            if ($classification.status -eq 'PASS') { $classification.status = 'FAILED' }
            if ($classification.status -eq 'BENIGN_TEARDOWN_RACE') { $classification.reason = 'Container disappeared between docker ps and inspect; teardown was confirmed.' }
            Add-DockerMonitoringIssue -CommandId $CommandId -Operation 'docker inspect' -ContainerId $containerId -Result $classification
            continue
        }
        try {
            $detail = ConvertFrom-DoctorContainerInspect -Json ($json -join "`n") -ExpectedContainerId $containerId `
                -ExpectedInvocationId $invocationId -ExpectedCommandId $CommandId
        } catch {
            Add-DockerMonitoringIssue -CommandId $CommandId -Operation 'docker inspect JSON parse' -ContainerId $containerId -Result ([pscustomobject]@{
                status = 'FAILED'; exit_code = 0; combined_output = (@($json | ForEach-Object { [string]$_ }) -join "`n"); container_state_after_failure = 'unknown'; reason = "docker inspect returned invalid container data: $($_.Exception.Message)"
            })
            continue
        }
        $statsOutput = @()
        $statsExitCode = 1
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $statsOutput = @(& docker stats --no-stream --format '{{.MemUsage}}|{{.PIDs}}' $containerId 2>&1)
            $statsExitCode = $LASTEXITCODE
        } catch {
            $statsOutput = @($_.Exception.Message)
            $statsExitCode = 1
        } finally {
            $ErrorActionPreference = $previousPreference
        }
        $statsCombinedOutput = (@($statsOutput | ForEach-Object { [string]$_ }) -join "`n").Trim()
        $statsStateAfter = if ($statsExitCode -eq 0 -and $statsCombinedOutput -match '^[^|\r\n]+\|\d+$') {
            [string]$detail.State.Status
        } else { (Get-DockerContainerState -ContainerId $containerId).state }
        $statsResult = Resolve-DockerStatsResult -ExitCode $statsExitCode -CombinedOutput $statsCombinedOutput -ContainerStateAfterFailure $statsStateAfter
        $statsResult.combined_output = ConvertTo-SanitizedText ([string]$statsResult.combined_output)
        $statsResult | Add-Member -NotePropertyName captured_at_utc -NotePropertyValue ([DateTime]::UtcNow.ToString('o'))
        Add-DockerMonitoringIssue -CommandId $CommandId -Operation 'docker stats' -ContainerId $containerId -Result $statsResult
        $mounts = @($detail.Mounts | ForEach-Object {
            [pscustomobject]@{ source = ConvertTo-SanitizedText $_.Source; destination = $_.Destination; read_write = $_.RW }
        })
        $violations = @()
        if ($detail.Config.User -ne '10001:10001' -or $detail.HostConfig.NanoCpus -ne 2000000000 -or
            $detail.HostConfig.Memory -ne 4294967296 -or $detail.HostConfig.PidsLimit -ne 256 -or
            $detail.HostConfig.NetworkMode -ne 'none' -or
            $detail.Image -ne (($runtimeBefore.image_inspect -split '\|')[0])) {
            $violations += 'runtime image/user/resource/network limits differ from the approved contract'
        }
        if (-not ($mounts | Where-Object { $_.destination -eq '/workspace' -and -not $_.read_write })) {
            $violations += 'workspace mount is not read-only'
        }
        if ($mounts | Where-Object { $_.destination -like '/input/*' -and $_.read_write }) {
            $violations += 'an input mount is writable'
        }
        if ($mounts | Where-Object { $_.destination -eq '/output' -and -not $_.read_write }) {
            $violations += 'an output mount is not writable'
        }
        $snapshot = [pscustomobject]@{
            command_id = $CommandId
            container_id = $detail.Id
            image_id = $detail.Image
            invocation_label = Get-DoctorEvidenceContainerLabel -Labels $detail.Config.Labels -Name 'org.weylume.isn-etl.invocation'
            command_label = Get-DoctorEvidenceContainerLabel -Labels $detail.Config.Labels -Name 'org.weylume.isn-etl.command'
            status = $detail.State.Status
            started_at = $detail.State.StartedAt
            user = $detail.Config.User
            cpus = [math]::Round($detail.HostConfig.NanoCpus / 1000000000, 2)
            memory_bytes = $detail.HostConfig.Memory
            pids_limit = $detail.HostConfig.PidsLimit
            network_mode = $detail.HostConfig.NetworkMode
            memory_usage = $statsResult.memory_usage
            pids_current = $statsResult.pids_current
            monitoring = $statsResult
            mounts = $mounts
            validation_errors = $violations
        }
        $containers.Add($snapshot)
    }
}

function Get-CommandContainerId {
    param([Parameter(Mandatory = $true)][string]$CommandId)
    $path = Join-Path $root "container-ids\$CommandId.cid"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    try {
        $containerId = [System.IO.File]::ReadAllText($path).Trim()
        if ($containerId -match '^[a-fA-F0-9]{12,64}$') { return $containerId }
    } catch { return $null }
    return $null
}

function Invoke-ChildProcess {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [hashtable]$Environment = @{},
        [string]$ContainerCommandId = '',
        [switch]$PreserveResultOnMonitoringFailure
    )
    $sequence = '{0:D3}' -f ($commands.Count + 1)
    $stdoutPath = Join-Path $root "logs\$sequence-$Name.stdout.txt"
    $stderrPath = Join-Path $root "logs\$sequence-$Name.stderr.txt"
    $commandLine = (($Arguments | ForEach-Object { ConvertTo-ProcessArgument ([string]$_) }) -join ' ')
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $FileName
    $start.Arguments = $commandLine
    $start.WorkingDirectory = $repo
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $start.StandardErrorEncoding = [System.Text.UTF8Encoding]::new($false)
    foreach ($key in $Environment.Keys) { $start.EnvironmentVariables[$key] = [string]$Environment[$key] }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $start
    $startedAt = [DateTime]::UtcNow
    if (-not $process.Start()) { throw "Cannot start child process: $FileName" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $pollingFailed = $false
    while (-not $process.WaitForExit(500)) {
        if ($ContainerCommandId -and -not $pollingFailed) {
            $pollResult = Invoke-DockerMonitoringAction { Get-ContainerSnapshot -CommandId $ContainerCommandId }
            if ($pollResult.status -eq 'FAILED') {
                $pollingFailed = $true
                Add-DockerMonitoringException -CommandId $ContainerCommandId -Operation 'container polling' -ContainerId (Get-CommandContainerId -CommandId $ContainerCommandId) -Message $pollResult.error
            }
        }
    }
    $process.WaitForExit()
    $childExitCode = [int]$process.ExitCode
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    [System.IO.File]::WriteAllText($stdoutPath, (ConvertTo-SanitizedText $stdout), [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText($stderrPath, (ConvertTo-SanitizedText $stderr), [System.Text.UTF8Encoding]::new($false))
    $entry = [pscustomobject]@{
        sequence = [int]$sequence
        name = $Name
        executable = [System.IO.Path]::GetFileName($FileName)
        arguments = @($Arguments | ForEach-Object { ConvertTo-SanitizedText ([string]$_) })
        started_at = $startedAt.ToString('o')
        finished_at = [DateTime]::UtcNow.ToString('o')
        child_pid = $process.Id
        exit_code = $childExitCode
        stdout = "logs/$sequence-$Name.stdout.txt"
        stderr = "logs/$sequence-$Name.stderr.txt"
        stdout_sha256 = Get-Sha256 -Path $stdoutPath
        stderr_sha256 = Get-Sha256 -Path $stderrPath
        docker_container_command_id = $ContainerCommandId
    }
    $commands.Add($entry)

    if ($ContainerCommandId) {
        $cidFile = Join-Path $root "container-ids\$ContainerCommandId.cid"
        $containerId = Get-CommandContainerId -CommandId $ContainerCommandId
        $finalMonitorResult = Invoke-DockerMonitoringAction { Get-ContainerSnapshot -CommandId $ContainerCommandId }
        if ($finalMonitorResult.status -eq 'FAILED') {
            Add-DockerMonitoringException -CommandId $ContainerCommandId -Operation 'post-exit container inspection' -ContainerId $containerId -Message $finalMonitorResult.error
        }
        $inventoryResult = Invoke-DockerMonitoringAction {
            $existingIds = @(& docker ps -a --no-trunc --format '{{.ID}}')
            $inventoryExit = $LASTEXITCODE
            if ($inventoryExit -ne 0) { throw "docker ps -a failed with exit code $inventoryExit." }
            [pscustomobject]@{ exit_code = $inventoryExit; container_ids = $existingIds }
        }
        $containerInventoryExitCode = if ($inventoryResult.status -eq 'PASS') { [int]$inventoryResult.value.exit_code } else { 1 }
        $existingContainerIds = if ($inventoryResult.status -eq 'PASS') { @($inventoryResult.value.container_ids) } else { @() }
        if ($inventoryResult.status -eq 'FAILED') {
            Add-DockerMonitoringIssue -CommandId $ContainerCommandId -Operation 'post-exit container inventory' -ContainerId '' -Result ([pscustomobject]@{
                status = 'FAILED'; exit_code = 1; combined_output = $inventoryResult.error; container_state_after_failure = 'unknown'; reason = 'Container removal could not be verified because docker ps -a failed.'
            })
        }
        $stillExists = $containerInventoryExitCode -eq 0 -and $containerId -and ($existingContainerIds -contains $containerId)
        $latestSnapshot = @($containers | Where-Object { $_.command_id -eq $ContainerCommandId } | Select-Object -Last 1)
        $stoppedSnapshots.Add([pscustomobject]@{
            command_id = $ContainerCommandId
            cidfile_id = $containerId
            inventory_check_exit_code = $containerInventoryExitCode
            no_container_started = ($null -eq $containerId)
            removed_after_exit = ($containerInventoryExitCode -eq 0 -and $null -ne $containerId -and -not $stillExists)
            final_status = if ($containerInventoryExitCode -ne 0) { 'inventory-check-failed' } elseif ($stillExists -and $latestSnapshot.Count -gt 0) { $latestSnapshot[0].status } elseif ($containerId) { 'removed-by---rm' } else { 'no-container-started' }
            mount_targets = if ($latestSnapshot.Count -gt 0) { @($latestSnapshot[0].mounts | ForEach-Object { $_.destination }) } else { @() }
        })
        $containerViolations = @($containers | Where-Object { $_.command_id -eq $ContainerCommandId } | ForEach-Object { $_.validation_errors } | Where-Object { $_ })
        if ($containerViolations.Count -gt 0) {
            $violationText = $containerViolations -join '; '
            Add-DockerMonitoringIssue -CommandId $ContainerCommandId -Operation 'container contract validation' -ContainerId $containerId -Result ([pscustomobject]@{
                status = 'FAILED'; exit_code = 0; combined_output = $violationText; container_state_after_failure = 'unknown'; reason = 'Docker container runtime or mount contract validation failed.'
            })
            if (-not $PreserveResultOnMonitoringFailure) { throw "Docker container contract violation for ${ContainerCommandId}: $violationText" }
        }
        $commandMonitoring = @($monitoringIssues | Where-Object { $_.command_id -eq $ContainerCommandId })
        $monitoringDisposition = Get-DockerMonitoringDisposition -ChildExitCode $childExitCode -MonitoringEvents $commandMonitoring
        $entry | Add-Member -NotePropertyName monitoring_status -NotePropertyValue $monitoringDisposition.status
        $entry | Add-Member -NotePropertyName monitoring_events -NotePropertyValue $commandMonitoring
        if ($monitoringDisposition.blocks_success -and -not $PreserveResultOnMonitoringFailure) {
            throw "Docker monitoring failed while '$Name' exited successfully; Spark/CLI result is retained separately and the run will not be marked PASS."
        }
    }
    return [pscustomobject]@{ entry = $entry; stdout = $stdout; stderr = $stderr }
}

function Invoke-Launcher {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string[]]$LauncherArguments,
        [hashtable]$Environment = @{}
    )
    $commandId = "c{0:D3}" -f ($commands.Count + 1)
    $containerIdPath = Join-Path $root "container-ids\$commandId.cid"
    $childEnvironment = @{
        ISN_ETL_INVOCATION_ID = $invocationId
        ISN_ETL_COMMAND_ID = $commandId
        ISN_ETL_CONTAINER_ID_FILE = $containerIdPath
    }
    foreach ($key in $Environment.Keys) { $childEnvironment[$key] = $Environment[$key] }
    $psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $args = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $launcher) + $LauncherArguments
    return Invoke-ChildProcess -Name $Name -FileName $psExe -Arguments $args -Environment $childEnvironment -ContainerCommandId $commandId
}

function Assert-Command {
    param(
        [Parameter(Mandatory = $true)][object]$Result,
        [Parameter(Mandatory = $true)][int]$ExpectedExitCode,
        [string]$OutputPattern = ''
    )
    if ($Result.entry.exit_code -ne $ExpectedExitCode) {
        throw "$($Result.entry.name): expected exit $ExpectedExitCode, got $($Result.entry.exit_code). See $($Result.entry.stdout) and $($Result.entry.stderr)."
    }
    if ($OutputPattern -and (($Result.stdout + $Result.stderr) -notmatch $OutputPattern)) {
        throw "$($Result.entry.name): expected diagnostic matching '$OutputPattern'."
    }
}

function New-Manifest {
    param([string]$DatasetId, [string]$SourceFile, [string]$SourceFormat, [string]$SourcePath, [string]$ContentPath)
    $sourceFileInfo = Get-Item -LiteralPath $SourcePath
    $sourceBytes = [System.IO.File]::ReadAllBytes($SourcePath)
    if ($SourceFormat -eq 'gzip') {
        $memory = [System.IO.MemoryStream]::new($sourceBytes)
        $stream = [System.IO.Compression.GZipStream]::new($memory, [System.IO.Compression.CompressionMode]::Decompress)
        $decoded = [System.IO.MemoryStream]::new()
        $stream.CopyTo($decoded)
        $stream.Dispose(); $memory.Dispose()
        $contentBytes = $decoded.ToArray(); $decoded.Dispose()
    } else {
        $contentBytes = $sourceBytes
    }
    $metadata = Read-JsonFile -Path $templateManifestPath
    $metadata.dataset_id = $DatasetId
    $metadata.source_file = $SourceFile
    $metadata.source_format = $SourceFormat
    $metadata.source_sha256 = Get-Sha256 -Path $SourcePath
    $metadata.uncompressed_sha256 = if ($SourceFormat -eq 'gzip') {
        $hash = [Security.Cryptography.SHA256]::Create()
        try { [BitConverter]::ToString($hash.ComputeHash($contentBytes)).Replace('-', '').ToLowerInvariant() }
        finally { $hash.Dispose() }
    } else { Get-Sha256 -Path $ContentPath }
    $metadata.source_bytes = $sourceFileInfo.Length
    $metadata.content_bytes = $contentBytes.Length
    $metadata.acquired_at = $null
    $metadata.source_url = $null
    $metadata.expected_reference_counts = $null
    return $metadata
}

function Write-CaseManifest {
    param([string]$Directory, [object]$Manifest)
    $path = Join-Path $Directory 'manifest.json'
    Write-JsonFile -Path $path -Value $Manifest
    return $path
}

function Assert-FrozenVariant {
    param([string]$Name, [string]$SourcePath, [object]$Pin)
    $actualBytes = (Get-Item -LiteralPath $SourcePath).Length
    $actualHash = Get-Sha256 -Path $SourcePath
    if ($actualBytes -ne $Pin.source_bytes -or $actualHash -ne $Pin.source_sha256) {
        throw "Host fixture pin mismatch for ${Name}: bytes=$actualBytes sha256=$actualHash"
    }
}

function Invoke-Run {
    param([string]$Name, [string]$SourcePath, [string]$ManifestPath, [string]$OutputRoot, [int]$ExpectedExitCode = 0, [string]$Pattern = '')
    Assert-SparkLaunchHeadroom -Name $Name
    [System.IO.Directory]::CreateDirectory($OutputRoot) | Out-Null
    $result = Invoke-Launcher -Name $Name -LauncherArguments @(
        'run', '-Source', $SourcePath, '-Manifest', $ManifestPath, '-OutputRoot', $OutputRoot
    )
    Assert-Command -Result $result -ExpectedExitCode $ExpectedExitCode -OutputPattern $Pattern
    $observed = @($containers | Where-Object { $_.command_id -eq $result.entry.docker_container_command_id })
    if ($observed.Count -gt 0) {
        $mounts = $observed[0].mounts
        $outputMount = @($mounts | Where-Object { $_.destination -eq '/output' -and $_.read_write })
        $inputMounts = @($mounts | Where-Object { $_.destination -like '/input/*' -and -not $_.read_write })
        if ($outputMount.Count -ne 1 -or $inputMounts.Count -ne 2) { throw "$Name Docker bind-mount behavior differs from the requested read-only inputs/writable output." }
        if ($outputMount[0].source -notmatch [regex]::Escape([System.IO.Path]::GetFileName($OutputRoot))) { throw "$Name Docker output bind is not correlated with its invocation-owned output root." }
        if (-not ($inputMounts | Where-Object { $_.source -match [regex]::Escape([System.IO.Path]::GetFileName($SourcePath)) })) { throw "$Name Docker source mount is not correlated with the selected source file." }
    } elseif ($ExpectedExitCode -eq 0) {
        throw "$Name exited without a live correlated Docker container snapshot."
    }
    return $result
}

function Get-RuntimeBaseline {
    $docker = Get-CurrentDoctorDockerIdentity
    $imageInfo = & docker image inspect --format '{{.Id}}|{{.Os}}|{{.Architecture}}|{{.Config.User}}' $Image
    if ($LASTEXITCODE -ne 0) { throw "The pre-pinned runtime image is unavailable: $Image" }
    $osInfo = Get-CimInstance Win32_OperatingSystem
    return [pscustomobject]@{
        docker_cpus = [int]$docker.cpus
        docker_memory_bytes = [long]$docker.memory_bytes
        docker_os = $docker.os
        docker_architecture = $docker.architecture
        docker_identity = $docker
        host_logical_processors = [int]$env:NUMBER_OF_PROCESSORS
        host_visible_memory_bytes = [long]$osInfo.TotalVisibleMemorySize * 1KB
        host_free_memory_bytes = [long]$osInfo.FreePhysicalMemory * 1KB
        image = $Image
        image_inspect = $imageInfo
        running_containers = @(& docker ps --no-trunc --format '{{.ID}}|{{.Image}}|{{.Status}}|{{.Names}}')
        all_containers = @(& docker ps -a --no-trunc --format '{{.ID}}|{{.Image}}|{{.Status}}|{{.Names}}')
        volumes = @(& docker volume ls --format '{{.Name}}|{{.Driver}}')
    }
}

function Get-ConflictingAcceptanceProcesses {
    $processes = @(Get-CimInstance Win32_Process)
    $byId = @{}; foreach ($process in $processes) { $byId[[int]$process.ProcessId] = $process }
    $excludedIds = @{}
    $ancestorId = [int]$PID
    while ($ancestorId -gt 0 -and $byId.ContainsKey($ancestorId) -and -not $excludedIds.ContainsKey($ancestorId)) {
        $excludedIds[$ancestorId] = $true
        $ancestorId = [int]$byId[$ancestorId].ParentProcessId
    }
    return @($processes | Where-Object {
        -not $excludedIds.ContainsKey([int]$_.ProcessId) -and
        (Test-IsConflictingAcceptanceProcess -Name $_.Name -CommandLine $_.CommandLine)
    } | ForEach-Object { "$($_.Name):$($_.ProcessId)" })
}

function Test-CurrentDoctorEvidencePath {
    param([Parameter(Mandatory = $true)][string]$EvidencePath)
    $dockerNow = Get-CurrentDoctorDockerIdentity
    $imageNow = & docker image inspect --format '{{.Id}}|{{.Os}}|{{.Architecture}}|{{.Config.User}}' $Image
    if ($LASTEXITCODE -ne 0) { throw 'Could not establish the current pinned Docker image identity for Doctor evidence validation.' }
    $imagePartsNow = $imageNow -split '\|'
    $runningNow = @(& docker ps --no-trunc --format '{{.ID}}|{{.Image}}|{{.Status}}|{{.Names}}')
    if ($LASTEXITCODE -ne 0) { throw 'Could not establish active Docker workloads for Doctor evidence validation.' }
    $allContainerIdsNow = @(& docker ps -a --no-trunc --format '{{.ID}}')
    if ($LASTEXITCODE -ne 0) { throw 'Could not establish full Docker container inventory for Doctor evidence validation.' }
    $processesNow = @(Get-ConflictingAcceptanceProcesses)
    $fingerprintsNow = @(Get-DoctorSourceFingerprints -Repository $repo)
    $branchNow = git -C $repo branch --show-current
    $headNow = git -C $repo rev-parse HEAD
    $hostFreeBytesNow = Get-AvailableHostMemoryBytes
    $validation = Test-DoctorEvidence -EvidencePath $EvidencePath -ExpectedImage $Image `
        -CurrentImage ([pscustomobject]@{ reference = $Image; id = $imagePartsNow[0]; os = $imagePartsNow[1]; architecture = $imagePartsNow[2]; user = $imagePartsNow[3] }) `
        -CurrentDocker $dockerNow -CurrentLimits $doctorLimits -CurrentRuntimeDependencies $doctorRuntimeDependencies `
        -CurrentSourceFingerprints $fingerprintsNow -CurrentRepository $repo -CurrentBranch $branchNow -CurrentHead $headNow `
        -CurrentHostFreeBytes $hostFreeBytesNow -MinimumHostFreeBytes $minimumHostFreeBytes `
        -RunningContainers $runningNow -ConflictingProcesses $processesNow -CurrentAllContainerIds $allContainerIdsNow
    $validation | Add-Member -NotePropertyName current_environment -NotePropertyValue ([pscustomobject]@{
        captured_at_utc = [DateTime]::UtcNow.ToString('o')
        host_free_memory_bytes = $hostFreeBytesNow
        host_free_memory_gib = [math]::Round($hostFreeBytesNow / 1GB, 3)
        docker = $dockerNow
        image_inspect = $imageNow
        active_containers = $runningNow
        all_container_count = $allContainerIdsNow.Count
        conflicting_processes = $processesNow
        runtime_fingerprints = $fingerprintsNow
        branch = $branchNow
        head = $headNow
    })
    return $validation
}

function Assert-SparkLaunchHeadroom {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Test-AcceptanceMonitoringClean -MonitoringEvents $monitoringIssues.ToArray())) {
        $script:failureStatus = 'DOCKER_MONITORING_FAILED'
        throw "${Name}: prior Docker monitoring failed; refusing to launch another Spark workload. Child exit codes remain in command evidence."
    }
    $dockerNow = Get-CurrentDoctorDockerIdentity
    foreach ($field in @('context_name', 'configuration_sha256', 'daemon_id', 'server_version', 'client_version', 'docker_cli_sha256', 'powershell_version', 'powershell_executable_sha256', 'launcher_powershell_executable_sha256', 'os', 'architecture')) {
        if ($dockerNow.$field -ne $runtimeBefore.docker_identity.$field) { throw "${Name}: Docker $field changed after acceptance preflight." }
    }
    if ($dockerNow.cpus -lt 2 -or $dockerNow.memory_bytes -lt $doctorLimits.memory_bytes) { throw "${Name}: current Docker capacity is below the approved Spark limits." }
    $imageNow = & docker image inspect --format '{{.Id}}|{{.Os}}|{{.Architecture}}|{{.Config.User}}' $Image
    if ($LASTEXITCODE -ne 0 -or $imageNow -ne $runtimeBefore.image_inspect) { throw "${Name}: pinned local Docker image identity changed after acceptance preflight." }
    $runningNow = @(& docker ps --no-trunc --format '{{.ID}}|{{.Image}}|{{.Status}}|{{.Names}}')
    if ($LASTEXITCODE -ne 0 -or $runningNow.Count -gt 0) { throw "${Name}: a Docker container is active or the active-container check failed." }
    $conflictingProcesses = @(Get-ConflictingAcceptanceProcesses)
    if ($conflictingProcesses.Count -gt 0) { throw "${Name}: conflicting acceptance/Spark processes are active: $($conflictingProcesses -join ', ')" }
    $fingerprintsNow = @(Get-DoctorSourceFingerprints -Repository $repo)
    if ((ConvertTo-Json $fingerprintsNow -Depth 8 -Compress) -ne (ConvertTo-Json $doctorSourceFingerprints -Depth 8 -Compress)) {
        throw "${Name}: runtime source/configuration changed after Doctor compatibility validation."
    }
    $availableBytes = Get-AvailableHostMemoryBytes
    $snapshot = [pscustomobject]@{
        name = $Name
        captured_at_utc = [DateTime]::UtcNow.ToString('o')
        available_bytes = $availableBytes
        available_gib = [math]::Round($availableBytes / 1GB, 3)
        required_bytes = $script:minimumHostFreeBytes
        docker_daemon_id = $dockerNow.daemon_id
        docker_context = $dockerNow.context_name
        result = if ($availableBytes -ge $script:minimumHostFreeBytes) { 'PASS' } else { 'BLOCKED' }
    }
    $script:sparkLaunchMeasurements.Add($snapshot)
    if ($availableBytes -lt $script:minimumHostFreeBytes) {
        $script:failureStatus = 'BLOCKED_PRE_SPARK_HOST_RAM'
        throw "${Name}: host has only $($snapshot.available_gib) GiB free; refusing to start a Spark container below the 4.5-GiB gate."
    }
}

try {
    if (-not (Test-Path -LiteralPath $HistoricalBaseline -PathType Leaf)) { throw "Historical baseline missing: $HistoricalBaseline" }
    if (-not (Test-Path -LiteralPath $VariantFixtureRoot -PathType Container)) { throw "Frozen variant fixture root missing: $VariantFixtureRoot" }
    if (-not (Test-Path -LiteralPath $expectedPath -PathType Leaf)) { throw "Expected fixture specification missing: $expectedPath" }
    if (Test-Path -LiteralPath $root) { throw "Refusing to reuse invocation root: $root" }

    foreach ($directory in @('baseline', 'fixtures', 'fixtures\variants', 'logs', 'outputs', 'reports', 'container-ids')) {
        [System.IO.Directory]::CreateDirectory((Join-Path $root $directory)) | Out-Null
    }
    Copy-Item -LiteralPath $HistoricalBaseline -Destination (Join-Path $root 'baseline\historical-before.json')
    Get-ChildItem -LiteralPath $VariantFixtureRoot | Copy-Item -Destination (Join-Path $root 'fixtures\variants') -Recurse
    $pins = Read-JsonFile -Path $expectedPath
    $sourceBaseline = @(
        'tests/fixtures/data_pipeline/synthetic-edges.txt',
        'tests/fixtures/data_pipeline/synthetic-edges.manifest.json',
        'tests/fixtures/data_pipeline/acceptance-edges.txt',
        'tests/fixtures/data_pipeline/acceptance-edges.manifest.json',
        'tests/fixtures/data_pipeline/acceptance-edges.expected.json'
    ) | ForEach-Object {
        $path = Join-Path $repo $_.Replace('/', '\')
        [pscustomobject]@{ path = $_; bytes = (Get-Item -LiteralPath $path).Length; sha256 = Get-Sha256 -Path $path }
    }
    $runtimeBefore = Get-RuntimeBaseline
    $doctorSourceFingerprints = @(Get-DoctorSourceFingerprints -Repository $repo)
    $currentBranch = git -C $repo branch --show-current
    $currentHead = git -C $repo rev-parse HEAD
    $conflictingProcesses = @(Get-ConflictingAcceptanceProcesses)
    if ($runtimeBefore.host_free_memory_bytes -lt $minimumHostFreeBytes) {
        throw "Host has only $([math]::Round($runtimeBefore.host_free_memory_bytes / 1GB, 2)) GiB free; acceptance requires at least 4.5 GiB before starting another Spark container."
    }
    if ($runtimeBefore.docker_cpus -lt 2 -or $runtimeBefore.docker_memory_bytes -lt $doctorLimits.memory_bytes -or $runtimeBefore.docker_os -ne 'linux' -or $runtimeBefore.docker_architecture -ne 'x86_64') {
        throw 'Docker capacity or platform is below the approved Linux/amd64 Spark runtime contract.'
    }
    $imageExpected = (Read-JsonFile -Path $HistoricalBaseline).image_info
    $imageIdentity = (($runtimeBefore.image_inspect -split '\|' | Select-Object -First 3) -join '|')
    if ($imageIdentity -ne $imageExpected) { throw 'Pinned Docker image identity/OS/architecture changed since the protected baseline.' }
    if ($runtimeBefore.image_inspect -notmatch '\|linux\|amd64\|10001:10001$') { throw "Unexpected runtime image contract: $($runtimeBefore.image_inspect)" }
    if ($currentBranch -ne 'feature/data-ingestion-spark-etl') { throw 'Acceptance must run on feature/data-ingestion-spark-etl.' }
    if ($currentHead -ne '24181d9d9af24506fe2194fe7b4eef566e166d98') { throw 'Acceptance HEAD differs from the authorized worktree baseline.' }
    if ($runtimeBefore.running_containers.Count -gt 0) { throw 'Refusing Spark acceptance while unrelated Docker containers are running.' }
    if ($conflictingProcesses.Count -gt 0) { throw "Refusing acceptance while conflicting Spark/acceptance processes are active: $($conflictingProcesses -join ', ')" }
    $imageParts = $runtimeBefore.image_inspect -split '\|'
    $currentImage = [pscustomobject]@{ reference = $Image; id = $imageParts[0]; os = $imageParts[1]; architecture = $imageParts[2]; user = $imageParts[3] }
    $beforeMemoryCheck = Get-AvailableHostMemoryBytes
    if ($beforeMemoryCheck -lt $minimumHostFreeBytes) { throw 'Current host RAM fell below the 4.5-GiB gate during acceptance preflight.' }

    $before = [pscustomobject]@{
        invocation_id = $invocationId
        root = $root
        captured_at = [DateTime]::UtcNow.ToString('o')
        repository = $repo
        branch = $currentBranch
        head = $currentHead
        git_status = @(git -C $repo status --porcelain=v1 --untracked-files=all)
        runtime = $runtimeBefore
        runtime_source_fingerprints = $doctorSourceFingerprints
        conflicting_processes = $conflictingProcesses
        source_fixtures = $sourceBaseline
    }
    Write-JsonFile -Path (Join-Path $root 'baseline\before.json') -Value $before

    $allExpectedRaw = @($pins.records | ForEach-Object { [string]$_.raw_text })
    $lfBytes = [System.IO.File]::ReadAllBytes((Join-Path $fixtureDir 'acceptance-edges.txt'))
    $lfText = [System.Text.UTF8Encoding]::new($false, $true).GetString($lfBytes)
    $actualLines = $lfText.Split("`n")
    if ($actualLines[-1] -eq '') { $actualLines = $actualLines[0..($actualLines.Length - 2)] }
    if (($actualLines -join "`n") -ne ($allExpectedRaw -join "`n")) { throw 'Authored F1 source logical text differs from the independently frozen expected records.' }
    foreach ($name in @('lf', 'crlf', 'no_final_lf', 'gzip')) {
        $sourceName = [string]$pins.variants.$name.source_file
        $sourcePath = if ($name -eq 'lf') {
            Join-Path $fixtureDir 'acceptance-edges.txt'
        } else {
            Join-Path $root "fixtures\variants\$name\$sourceName"
        }
        Assert-FrozenVariant -Name $name -SourcePath $sourcePath -Pin $pins.variants.$name
        $bytes = [System.IO.File]::ReadAllBytes($sourcePath)
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { throw "$name variant unexpectedly has a UTF-8 BOM." }
        [byte[]]$contentBytes = if ($name -eq 'gzip') {
            $memory = [System.IO.MemoryStream]::new($bytes)
            $gzipStream = [System.IO.Compression.GZipStream]::new($memory, [System.IO.Compression.CompressionMode]::Decompress)
            $decodedStream = [System.IO.MemoryStream]::new()
            $gzipStream.CopyTo($decodedStream)
            $gzipStream.Dispose(); $memory.Dispose()
            $decoded = $decodedStream.ToArray(); $decodedStream.Dispose()
            $decoded
        } else { $bytes }
        $hostHash = [Security.Cryptography.SHA256]::Create()
        try { $decodedSha256 = [BitConverter]::ToString($hostHash.ComputeHash($contentBytes)).Replace('-', '').ToLowerInvariant() }
        finally { $hostHash.Dispose() }
        if ($contentBytes.Length -ne $pins.variants.$name.content_bytes -or $decodedSha256 -ne $pins.variants.$name.content_sha256) { throw "Decoded host content differs from the frozen pin for $name." }
        $text = [System.Text.UTF8Encoding]::new($false, $true).GetString($contentBytes)
        if ($name -eq 'lf' -or $name -eq 'gzip') {
            if ($text.Contains("`r") -or -not $text.EndsWith("`n")) { throw "$name must use LF and one final newline." }
        }
        if ($name -eq 'crlf') {
            if (-not $text.EndsWith("`r`n") -or $text.Replace("`r`n", '').Contains("`n") -or $text.Replace("`r`n", '').Contains("`r")) { throw 'CRLF fixture line-ending specification failed.' }
        }
        if ($name -eq 'no_final_lf' -and ($text.EndsWith("`n") -or $text.EndsWith("`r"))) { throw 'No-final-LF fixture unexpectedly ends in a newline.' }
        $logicalText = $text.Replace("`r`n", "`n")
        $logicalLines = $logicalText.Split("`n")
        if ($logicalText.EndsWith("`n")) { $logicalLines = $logicalLines[0..($logicalLines.Length - 2)] }
        if (($logicalLines -join "`n") -ne ($allExpectedRaw -join "`n")) { throw "$name decoded logical records differ from the frozen expectation." }
        if ($name -eq 'crlf' -and (($bytes | Where-Object { $_ -eq 13 }).Count -ne $pins.line_count)) { throw 'CRLF variant has an unexpected carriage-return count.' }
        $caseDir = Join-Path $root "fixtures\$name"
        [System.IO.Directory]::CreateDirectory($caseDir) | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $caseDir $sourceName)
        $format = [string]$pins.variants.$name.source_format
        $manifest = if ($name -eq 'lf') {
            Read-JsonFile -Path $templateManifestPath
        } else {
            New-Manifest -DatasetId $pins.dataset_id -SourceFile $sourceName -SourceFormat $format -SourcePath (Join-Path $caseDir $sourceName) -ContentPath (Join-Path $caseDir $sourceName)
        }
        if ($name -ne 'lf') {
            $manifest.uncompressed_sha256 = $pins.variants.$name.content_sha256
            $manifest.content_bytes = $pins.variants.$name.content_bytes
        }
        Write-CaseManifest -Directory $caseDir -Manifest $manifest | Out-Null
        $caseResults.Add([pscustomobject]@{ name = "f1_$name"; kind = 'f1'; variant = $name; dataset_id = $pins.dataset_id; source = $sourceName; manifest = 'manifest.json'; run_id = $pins.variants.$name.run_id; output = "outputs/f1-$name" })
    }
    if ($allExpectedRaw[7] -ne "2`t10") { throw 'F1 byte specification lost its literal tab.' }

    foreach ($name in @('single_edge', 'malformed_only', 'empty', 'resource')) {
        $pin = $pins.additional_inputs.$name
        $sourceName = [string]$pin.source_file
        $sourcePath = Join-Path $root "fixtures\variants\$name\$sourceName"
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Frozen additional source fixture missing: $sourcePath" }
        Assert-FrozenVariant -Name $name -SourcePath $sourcePath -Pin $pin
        $caseDir = Join-Path $root "fixtures\$name"
        [System.IO.Directory]::CreateDirectory($caseDir) | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $caseDir $sourceName)
        $manifest = New-Manifest -DatasetId $pin.dataset_id -SourceFile $sourceName -SourceFormat $pin.source_format -SourcePath (Join-Path $caseDir $sourceName) -ContentPath (Join-Path $caseDir $sourceName)
        $manifest.uncompressed_sha256 = $pin.content_sha256
        $manifest.content_bytes = $pin.content_bytes
        Write-CaseManifest -Directory $caseDir -Manifest $manifest | Out-Null
        if ($name -in @('single_edge', 'resource')) {
            $caseResults.Add([pscustomobject]@{
                name = $name
                kind = $name
                variant = $name
                dataset_id = $pin.dataset_id
                source = $sourceName
                manifest = 'manifest.json'
                run_id = $pin.run_id
                output = "outputs/$name"
            })
        }
    }

    if ($DoctorEvidencePath) {
        $doctorEvidencePathResolved = [System.IO.Path]::GetFullPath($DoctorEvidencePath)
        $doctorValidation = Test-CurrentDoctorEvidencePath -EvidencePath $doctorEvidencePathResolved
        $doctorDecision = Resolve-DoctorExecution -EvidencePath $doctorEvidencePathResolved -Validation $doctorValidation
        $doctorOutcome = New-DoctorOutcome -Mode $doctorDecision.mode -Validation $doctorValidation -EvidencePath $doctorEvidencePathResolved
        $doctorReuseOutcome = $doctorOutcome
        Write-JsonFile -Path (Join-Path $root 'reports\doctor-evidence-validation.json') -Value $doctorValidation
        if ($doctorDecision.mode -ne 'REUSED') {
            $failureStatus = 'DOCTOR_EVIDENCE_REJECTED'
            throw "Doctor evidence reuse rejected; no automatic Doctor fallback or Spark work was started: $($doctorDecision.reasons -join '; ')"
        }
        $etl00Status = $doctorOutcome.etl_00_status
    } else {
        $fingerprintsBeforeDoctor = @(Get-DoctorSourceFingerprints -Repository $repo)
        if ((ConvertTo-Json $fingerprintsBeforeDoctor -Depth 8 -Compress) -ne (ConvertTo-Json $doctorSourceFingerprints -Depth 8 -Compress)) {
            throw 'Runtime source/configuration changed during preflight; refusing to execute Doctor against a moving code snapshot.'
        }
        Assert-SparkLaunchHeadroom -Name 'docker-doctor'
        $doctor = Invoke-Launcher -Name 'doctor' -LauncherArguments @('doctor')
        try {
            Assert-Command -Result $doctor -ExpectedExitCode 0 -OutputPattern 'DOCKER_SPARK_PARQUET_SMOKE=PASS'
            $doctorEvidencePathResolved = Join-Path $root 'reports\doctor-evidence.json'
            $doctorValidation = [pscustomobject]@{
                eligible = $false
                validation_status = 'NOT_RUN_IMMEDIATE_POST_DOCTOR_VALIDATION'
                evidence_reference = $doctorEvidencePathResolved
                doctor_invocation_id = $invocationId
                compatible_checks = @('Fresh Doctor command exited 0 and emitted the required PASS marker.')
                reasons = @('Immediate strict validation has not run.')
            }
            $doctorOutcome = New-DoctorOutcome -Mode 'EXECUTED' -Validation $doctorValidation -EvidencePath $doctorEvidencePathResolved
            $etl00Status = $doctorOutcome.etl_00_status
            $doctorContainerMatches = @($containers | Where-Object { $_.command_id -eq $doctor.entry.docker_container_command_id })
            if ($doctorContainerMatches.Count -eq 0) { throw 'Could not correlate the actual doctor container to its invocation ID.' }
            $doctorContainer = $doctorContainerMatches[-1]
            $doctorCleanupMatches = @($stoppedSnapshots | Where-Object { $_.command_id -eq $doctor.entry.docker_container_command_id })
            if ($doctorCleanupMatches.Count -ne 1 -or -not $doctorCleanupMatches[0].removed_after_exit) { throw 'Doctor cidfile/--rm teardown evidence is incomplete.' }
            $doctorEvidence = New-DoctorEvidenceRecord -ArtifactRoot $root -InvocationId $invocationId -Repository $repo `
                -Branch $currentBranch -Head $currentHead -Image $currentImage -Docker $runtimeBefore.docker_identity `
                -Limits $doctorLimits -RuntimeDependencies $doctorRuntimeDependencies -SourceFingerprints $fingerprintsBeforeDoctor `
                -Command $doctor.entry -Container $doctorContainer -ContainerCleanup $doctorCleanupMatches[0]
            Write-JsonFile -Path $doctorEvidencePathResolved -Value $doctorEvidence

            try {
                $doctorValidation = Test-CurrentDoctorEvidencePath -EvidencePath $doctorEvidencePathResolved
            } catch {
                $failureStatus = 'DOCTOR_EVIDENCE_VALIDATION_FAILED'
                $etl00Status = 'BLOCKED_DOCKER_EVIDENCE_VALIDATION'
                throw "Immediate strict Doctor evidence validation could not complete: $($_.Exception.Message)"
            }
            $immediateDisposition = Get-DoctorEvidenceImmediateDisposition -Validation $doctorValidation
            $doctorValidation | Add-Member -NotePropertyName validation_status -NotePropertyValue $immediateDisposition -Force
            $doctorValidation | Add-Member -NotePropertyName immediate_disposition -NotePropertyValue $immediateDisposition -Force
            Write-JsonFile -Path (Join-Path $root 'reports\doctor-evidence-validation-immediate.json') -Value $doctorValidation
            Write-JsonFile -Path (Join-Path $root 'reports\doctor-evidence-validation.json') -Value $doctorValidation
            $doctorOutcome = New-DoctorOutcome -Mode 'EXECUTED' -Validation $doctorValidation -EvidencePath $doctorEvidencePathResolved
            $etl00Status = $doctorOutcome.etl_00_status
            if ($immediateDisposition -eq 'REJECTED') {
                $failureStatus = 'DOCTOR_EVIDENCE_REJECTED'
                throw "Fresh Doctor evidence failed immediate strict validation: $($doctorValidation.reasons -join '; ')"
            }

            $doctorPostflight = Wait-ForHostMemoryHeadroom -Phase 'post-doctor' -MinimumBytes $minimumHostFreeBytes -ReadAvailableBytes { Get-AvailableHostMemoryBytes } -RecoveryAttempts 4 -RecoveryIntervalSeconds 15
            if (-not $doctorPostflight.passed) {
                $failureStatus = 'BLOCKED_POST_DOCTOR_HOST_RAM'
                $etl00Status = 'BLOCKED_POST_DOCTOR_HOST_RAM'
                $lastDoctorSample = @($doctorPostflight.samples | Select-Object -Last 1)[0]
                throw "Post-Doctor host RAM remained at $($lastDoctorSample.available_gib) GiB after $($doctorPostflight.waited_seconds) seconds of bounded passive recovery; no further acceptance work was started."
            }
            try {
                $doctorValidation = Test-CurrentDoctorEvidencePath -EvidencePath $doctorEvidencePathResolved
            } catch {
                $failureStatus = 'DOCTOR_EVIDENCE_VALIDATION_FAILED'
                $etl00Status = 'BLOCKED_DOCKER_EVIDENCE_VALIDATION'
                throw "Post-recovery strict Doctor evidence validation could not complete: $($_.Exception.Message)"
            }
            $finalDisposition = Get-DoctorEvidenceImmediateDisposition -Validation $doctorValidation
            $doctorValidation | Add-Member -NotePropertyName validation_status -NotePropertyValue $finalDisposition -Force
            $doctorValidation | Add-Member -NotePropertyName immediate_disposition -NotePropertyValue $immediateDisposition -Force
            $doctorOutcome = New-DoctorOutcome -Mode 'EXECUTED' -Validation $doctorValidation -EvidencePath $doctorEvidencePathResolved
            $etl00Status = $doctorOutcome.etl_00_status
            $doctorDecision = Resolve-DoctorExecution -EvidencePath $doctorEvidencePathResolved -Validation $doctorValidation
            $doctorReuseOutcome = New-DoctorOutcome -Mode $doctorDecision.mode -Validation $doctorValidation -EvidencePath $doctorEvidencePathResolved
            Write-JsonFile -Path (Join-Path $root 'reports\doctor-evidence-validation.json') -Value $doctorValidation
            if ($doctorDecision.mode -ne 'REUSED') {
                $failureStatus = 'DOCTOR_EVIDENCE_REJECTED'
                throw "Fresh Doctor evidence could not be safely reused; no further acceptance work was started: $($doctorDecision.reasons -join '; ')"
            }
            $etl00Status = 'PASS_FRESH_AND_REUSED_DOCKER_DOCTOR'
        } catch {
            if ($null -eq $doctorOutcome -and $null -ne $doctor) {
                $failedValidation = [pscustomobject]@{ doctor_invocation_id = $invocationId; compatible_checks = @(); reasons = @($_.Exception.Message) }
                $doctorOutcome = New-DoctorOutcome -Mode 'EXECUTED' -Validation $failedValidation -EvidencePath (Join-Path $root 'reports\doctor-evidence.json') -DoctorPassed $false
                $etl00Status = $doctorOutcome.etl_00_status
            }
            throw
        }
    }
    $unit = Invoke-Launcher -Name 'test-unit' -LauncherArguments @('test-unit')
    Assert-Command -Result $unit -ExpectedExitCode 0 -OutputPattern 'OK'
    Assert-SparkLaunchHeadroom -Name 'test-integration'
    $integration = Invoke-Launcher -Name 'test-integration' -LauncherArguments @('test-integration')
    Assert-Command -Result $integration -ExpectedExitCode 0 -OutputPattern 'OK'

    foreach ($name in @('lf', 'crlf', 'no_final_lf', 'gzip', 'resource', 'single_edge')) {
        $caseDir = Join-Path $root "fixtures\$name"
        $sourceName = if ($name -in @('lf', 'crlf', 'no_final_lf', 'gzip')) { $pins.variants.$name.source_file } else { $pins.additional_inputs.$name.source_file }
        $prepare = Invoke-Launcher -Name "prepare-$name" -LauncherArguments @(
            'prepare-source', '-Source', (Join-Path $caseDir $sourceName), '-Manifest', (Join-Path $caseDir 'manifest.json')
        )
        Assert-Command -Result $prepare -ExpectedExitCode 0 -OutputPattern '"status": "verified"'
    }

    foreach ($case in @($caseResults | Where-Object { $_.name -ne 'f1_lf' })) {
        $sourcePath = Join-Path $root "fixtures\$($case.variant)\$($case.source)"
        $manifestPath = Join-Path $root "fixtures\$($case.variant)\manifest.json"
        $outputPath = Join-Path $root $case.output
        $run = Invoke-Run -Name "run-$($case.name)" -SourcePath $sourcePath -ManifestPath $manifestPath -OutputRoot $outputPath
        Assert-Command -Result $run -ExpectedExitCode 0 -OutputPattern $case.run_id
    }

    $lfCase = @($caseResults | Where-Object { $_.name -eq 'f1_lf' })[0]
    $lfSource = Join-Path $root "fixtures\lf\$($lfCase.source)"
    $lfManifest = Join-Path $root 'fixtures\lf\manifest.json'
    $lfOutput = Join-Path $root $lfCase.output
    $firstLf = Invoke-Run -Name 'run-f1-lf-primary' -SourcePath $lfSource -ManifestPath $lfManifest -OutputRoot $lfOutput
    Assert-Command -Result $firstLf -ExpectedExitCode 0 -OutputPattern $lfCase.run_id
    $primarySnapshot = Get-TreeSnapshot -Path $lfOutput
    $reuse = Invoke-Run -Name 'reuse-f1-lf-primary' -SourcePath $lfSource -ManifestPath $lfManifest -OutputRoot $lfOutput
    Assert-Command -Result $reuse -ExpectedExitCode 0 -OutputPattern '"status": "reused"'
    $reuseSnapshot = Get-TreeSnapshot -Path $lfOutput
    if ((ConvertTo-Json $primarySnapshot -Depth 8 -Compress) -ne (ConvertTo-Json $reuseSnapshot -Depth 8 -Compress)) { throw 'Completed-run reuse modified published bytes.' }
    $caseResults.Add([pscustomobject]@{ name = 'f1_lf_independent'; kind = 'f1'; variant = 'lf'; dataset_id = $pins.dataset_id; source = $lfCase.source; manifest = 'manifest.json'; run_id = $lfCase.run_id; output = 'outputs/f1-lf-independent path' })
    $independentOutput = Join-Path $root 'outputs\f1-lf-independent path'
    $independent = Invoke-Run -Name 'run-f1-lf-independent' -SourcePath $lfSource -ManifestPath $lfManifest -OutputRoot $independentOutput
    Assert-Command -Result $independent -ExpectedExitCode 0 -OutputPattern $lfCase.run_id

    $metadataConflict = Read-JsonFile -Path $lfManifest
    $metadataConflict.citation = 'Changed metadata conflict test; not an accepted publication.'
    $conflictManifest = Join-Path $root 'fixtures\lf\metadata-conflict.json'
    Write-JsonFile -Path $conflictManifest -Value $metadataConflict
    $conflictBefore = Get-TreeSnapshot -Path $lfOutput
    $conflict = Invoke-Run -Name 'reject-metadata-conflict' -SourcePath $lfSource -ManifestPath $conflictManifest -OutputRoot $lfOutput -ExpectedExitCode 2 -Pattern 'does not match the current source/config identity'
    $conflictAfter = Get-TreeSnapshot -Path $lfOutput
    if ((ConvertTo-Json $conflictBefore -Depth 8 -Compress) -ne (ConvertTo-Json $conflictAfter -Depth 8 -Compress)) { throw 'Metadata-conflict rejection changed the completed publication.' }

    $malformedDir = Join-Path $root 'fixtures\malformed_only'
    $malformedOutput = Join-Path $root 'outputs\malformed-only'
    $malformedRun = Invoke-Run -Name 'reject-no-valid-edges' -SourcePath (Join-Path $malformedDir $pins.additional_inputs.malformed_only.source_file) -ManifestPath (Join-Path $malformedDir 'manifest.json') -OutputRoot $malformedOutput -ExpectedExitCode 2 -Pattern 'no valid graph edges'
    if (Get-ChildItem -LiteralPath $malformedOutput -Recurse -Filter '_COMPLETE.json' -File) { throw 'Malformed-only failure exposed a completed run.' }
    $malformedStagingFiles = @(Get-ChildItem -LiteralPath (Join-Path $malformedOutput '.staging') -Recurse -File)
    if ($malformedStagingFiles.Count -eq 0) { throw 'Malformed-only failure diagnostics/staging were not retained.' }
    $emptyDir = Join-Path $root 'fixtures\empty'
    $emptyOutput = Join-Path $root 'outputs\empty'
    $emptyRun = Invoke-Run -Name 'reject-empty-source' -SourcePath (Join-Path $emptyDir $pins.additional_inputs.empty.source_file) -ManifestPath (Join-Path $emptyDir 'manifest.json') -OutputRoot $emptyOutput -ExpectedExitCode 2 -Pattern 'empty'
    if (Get-ChildItem -LiteralPath $emptyOutput -Recurse -Filter '_COMPLETE.json' -File) { throw 'Empty-source failure exposed a completed run.' }

    $badInputs = Join-Path $root 'fixtures\negative'
    [System.IO.Directory]::CreateDirectory($badInputs) | Out-Null
    $invalidJson = Join-Path $badInputs 'invalid.json'
    [System.IO.File]::WriteAllText($invalidJson, '{', [System.Text.UTF8Encoding]::new($false))
    $invalidJsonRun = Invoke-Launcher -Name 'reject-invalid-manifest-json' -LauncherArguments @('prepare-source', '-Source', $lfSource, '-Manifest', $invalidJson)
    Assert-Command -Result $invalidJsonRun -ExpectedExitCode 2 -OutputPattern 'manifest|JSON'
    $tamperedSource = Join-Path $badInputs 'acceptance-edges.txt'
    [System.IO.File]::WriteAllBytes($tamperedSource, [System.IO.File]::ReadAllBytes($lfSource) + [byte[]](0x20))
    $tamperedManifest = Join-Path $badInputs 'tampered-manifest.json'
    Copy-Item -LiteralPath $lfManifest -Destination $tamperedManifest
    $tamperedRun = Invoke-Launcher -Name 'reject-source-checksum-mismatch' -LauncherArguments @('prepare-source', '-Source', $tamperedSource, '-Manifest', $tamperedManifest)
    Assert-Command -Result $tamperedRun -ExpectedExitCode 2 -OutputPattern 'SHA-256 mismatch'
    $invalidUtf8 = Join-Path $badInputs 'invalid-utf8.txt'
    $invalidUtf8Bytes = [byte[]](0x31, 0x20, 0xFF, 0x0A)
    [System.IO.File]::WriteAllBytes($invalidUtf8, $invalidUtf8Bytes)
    $invalidUtf8Manifest = New-Manifest -DatasetId 'isn-acceptance-invalid-utf8-v1' -SourceFile 'invalid-utf8.txt' -SourceFormat 'plain' -SourcePath $invalidUtf8 -ContentPath $invalidUtf8
    $invalidUtf8ManifestPath = Write-CaseManifest -Directory $badInputs -Manifest $invalidUtf8Manifest
    $invalidUtf8Run = Invoke-Launcher -Name 'reject-invalid-utf8' -LauncherArguments @('prepare-source', '-Source', $invalidUtf8, '-Manifest', $invalidUtf8ManifestPath)
    Assert-Command -Result $invalidUtf8Run -ExpectedExitCode 2 -OutputPattern 'UTF-8'
    $unauthorizedManifest = Read-JsonFile -Path $lfManifest
    $unauthorizedManifest.rights_status = 'unresolved'
    $unauthorizedManifest.rights_evidence = $null
    $unauthorizedPath = Join-Path $badInputs 'unresolved-rights.json'
    Write-JsonFile -Path $unauthorizedPath -Value $unauthorizedManifest
    $unauthorized = Invoke-Launcher -Name 'reject-unapproved-source' -LauncherArguments @('prepare-source', '-Source', $lfSource, '-Manifest', $unauthorizedPath)
    Assert-Command -Result $unauthorized -ExpectedExitCode 2 -OutputPattern 'rights|approved'
    $missing = Invoke-Launcher -Name 'reject-missing-source' -LauncherArguments @('prepare-source', '-Source', (Join-Path $badInputs 'missing.txt'), '-Manifest', $lfManifest)
    Assert-Command -Result $missing -ExpectedExitCode 2 -OutputPattern 'does not exist'
    $missingArgs = Invoke-Launcher -Name 'reject-run-missing-arguments' -LauncherArguments @('run')
    Assert-Command -Result $missingArgs -ExpectedExitCode 2 -OutputPattern 'requires -Source and -Manifest'
    $unavailableEndpoint = 'npipe:////./pipe/isn-etl-acceptance-unavailable'
    $unavailable = Invoke-Launcher -Name 'docker-endpoint-diagnostic' -LauncherArguments @('doctor') -Environment @{ DOCKER_HOST = $unavailableEndpoint }
    $unavailableOutput = $unavailable.stdout + $unavailable.stderr
    if (-not (Test-DockerUnavailableResult -ExitCode $unavailable.entry.exit_code -CombinedOutput $unavailableOutput)) {
        throw "docker-endpoint-diagnostic: expected exit 2 and a Docker connection-unavailable diagnostic for the intentionally unavailable endpoint; got exit $($unavailable.entry.exit_code). See $($unavailable.entry.stdout) and $($unavailable.entry.stderr)."
    }

    $caseManifest = [pscustomobject]@{ cases = @() }
    foreach ($case in $caseResults) {
        $runPath = Join-Path $root "$($case.output)\$($case.dataset_id)\runs\$($case.run_id)"
        $caseManifest.cases += [pscustomobject]@{
            case_name = $case.name
            kind = $case.kind
            variant = $case.variant
            run_path = '/acceptance/' + ($runPath.Substring($root.Length).TrimStart('\', '/').Replace('\', '/'))
            source_path = '/acceptance/fixtures/' + $case.variant + '/' + $case.source
            source_manifest_path = '/acceptance/fixtures/' + $case.variant + '/manifest.json'
        }
    }
    $caseManifestPath = Join-Path $root 'reports\cases.json'
    Write-JsonFile -Path $caseManifestPath -Value $caseManifest
    $dockerCaseManifest = '/acceptance/reports/cases.json'
    $dockerExpectedPath = '/workspace/tests/fixtures/data_pipeline/acceptance-edges.expected.json'
    $dockerRepo = $repo.Replace('\', '/')
    $dockerRoot = $root.Replace('\', '/')
    $verifyCommandId = "c{0:D3}" -f ($commands.Count + 1)
    $verifyCid = Join-Path $root "container-ids\$verifyCommandId.cid"
    $verifierArgs = @(
        'run', '--rm', '--platform', 'linux/amd64', '--cpus=2', '--memory=4g', '--pids-limit=256', '--network', 'none',
        '--hostname', 'isn-etl-acceptance-verifier', '--add-host', 'isn-etl-acceptance-verifier:127.0.0.1',
        '--label', "org.weylume.isn-etl.invocation=$invocationId",
        '--label', "org.weylume.isn-etl.command=$verifyCommandId", '--cidfile', $verifyCid,
        '--tmpfs', '/tmp:rw,nosuid,nodev,size=1g,mode=1777',
        '--tmpfs', '/run/isn-etl-snappy:rw,exec,nosuid,nodev,size=64m,mode=0700,uid=10001,gid=10001',
        '--mount', "type=bind,source=$dockerRepo,target=/workspace,readonly",
        '--mount', "type=bind,source=$dockerRoot,target=/acceptance,readonly",
        '--workdir', '/workspace', '--env', 'PYTHONPATH=/workspace/data-pipeline/src',
        '--env', 'PYSPARK_PYTHON=/opt/venv/bin/python', '--env', 'PYSPARK_DRIVER_PYTHON=/opt/venv/bin/python',
        '--env', 'JAVA_TOOL_OPTIONS=-Dorg.xerial.snappy.tempdir=/run/isn-etl-snappy -XX:ActiveProcessorCount=2',
        '--entrypoint', 'python', $Image, 'tests/integration/data_pipeline/acceptance_verify.py',
        '--case-manifest', $dockerCaseManifest, '--expected', $dockerExpectedPath
    )
    Assert-SparkLaunchHeadroom -Name 'independent-parquet-verifier'
    $verifier = Invoke-ChildProcess -Name 'independent-parquet-verifier' -FileName 'docker.exe' -Arguments $verifierArgs -Environment @{} -ContainerCommandId $verifyCommandId -PreserveResultOnMonitoringFailure
    $verifierResult = Resolve-IndependentVerifierResult -ExitCode $verifier.entry.exit_code -StandardOutput $verifier.stdout
    if ($null -ne $verifierResult.report) {
        Write-JsonFile -Path (Join-Path $root 'reports\independent-verification.json') -Value $verifierResult.report
    }
    if ($verifierResult.status -eq 'PASS') {
        $expectedTableNames = @('bronze/raw_edges', 'bronze/source_metadata', 'silver/nodes', 'silver/edges', 'silver/quarantine', 'silver/quality_metrics', 'gold/nodes', 'gold/edges')
        if (@($verifierResult.report.cases).Count -ne $caseResults.Count) {
            $verifierResult.status = 'VERIFIER_FAILED'
            $verifierResult.reason = "Verifier returned $(@($verifierResult.report.cases).Count) cases; expected $($caseResults.Count)."
        } else {
            $expectedCaseNames = @($caseResults | ForEach-Object { $_.name })
            $actualCaseNames = @($verifierResult.report.cases | ForEach-Object { $_.case_name })
            if (@(Compare-Object $expectedCaseNames $actualCaseNames).Count -gt 0) {
                $verifierResult.status = 'VERIFIER_FAILED'
                $verifierResult.reason = 'Verifier case names do not match the complete independently expected publication set.'
            }
            foreach ($verifiedCase in $verifierResult.report.cases) {
                $actualTableNames = @($verifiedCase.tables.PSObject.Properties | ForEach-Object { $_.Name })
                if (@(Compare-Object $expectedTableNames $actualTableNames).Count -gt 0) {
                    $verifierResult.status = 'VERIFIER_FAILED'
                    $verifierResult.reason = "Verifier case '$($verifiedCase.case_name)' did not report exactly the eight required tables."
                    break
                }
            }
        }
    }
    $verifierContainerSnapshots = @($containers | Where-Object { $_.command_id -eq $verifyCommandId })
    $verifierContainerIds = @($verifierContainerSnapshots | ForEach-Object { $_.container_id } | Sort-Object -Unique)
    $verifierRemovalRecords = @($stoppedSnapshots | Where-Object { $_.command_id -eq $verifyCommandId })
    $sparkTeardownStatus = 'NOT_CAPTURED'
    if ($null -ne $verifierResult.report) {
        $sparkTeardownStatus = if ($verifierResult.report.resources.spark_context_stopped -eq $true -and $verifierResult.report.resources.active_spark_session_after_stop -eq $false) { 'PASS' } else { 'FAILED' }
    }
    $runtimeEvidenceStatus = 'PASS'
    $runtimeEvidenceReason = $null
    if ($verifierContainerIds.Count -ne 1 -or $verifierRemovalRecords.Count -ne 1 -or
        -not $verifierRemovalRecords[0].removed_after_exit -or
        $verifierRemovalRecords[0].cidfile_id -ne $verifierContainerIds[0]) {
        $runtimeEvidenceStatus = 'FAILED'
        $runtimeEvidenceReason = 'Verifier Docker container identity, runtime sample, or --rm teardown evidence is missing or mismatched.'
    }
    Write-JsonFile -Path (Join-Path $root 'reports\independent-verification-result.json') -Value ([pscustomobject]@{
        status = $verifierResult.status
        reason = $verifierResult.reason
        process_exit_code = $verifier.entry.exit_code
        stdout = $verifier.entry.stdout
        stderr = $verifier.entry.stderr
        monitoring_status = $verifier.entry.monitoring_status
        spark_teardown_status = $sparkTeardownStatus
        runtime_evidence_status = $runtimeEvidenceStatus
        runtime_evidence_reason = $runtimeEvidenceReason
        observed_container_ids = $verifierContainerIds
        removed_container_record = $verifierRemovalRecords
        verifier_report = if ($null -ne $verifierResult.report) { 'independent-verification.json' } else { $null }
        captured_at_utc = [DateTime]::UtcNow.ToString('o')
    })
    if ($verifierResult.status -ne 'PASS') {
        throw "Independent verifier $($verifierResult.status): $($verifierResult.reason). Child output and monitoring evidence were saved separately."
    }
    if ($runtimeEvidenceStatus -ne 'PASS') {
        $failureStatus = 'DOCKER_MONITORING_FAILED'
        throw "Independent verifier Docker monitoring evidence failed: $runtimeEvidenceReason"
    }
    $verifyReport = $verifierResult.report
    $primaryLogical = @($verifyReport.cases | Where-Object { $_.case_name -eq 'f1_lf' })[0]
    $independentLogical = @($verifyReport.cases | Where-Object { $_.case_name -eq 'f1_lf_independent' })[0]
    foreach ($table in @('silver/nodes', 'silver/edges', 'silver/quarantine', 'silver/quality_metrics', 'gold/nodes', 'gold/edges')) {
        if ($primaryLogical.tables.$table.logical_sha256 -ne $independentLogical.tables.$table.logical_sha256) {
            throw "Independent LF publications differ logically for $table."
        }
    }
    $gzipLogical = @($verifyReport.cases | Where-Object { $_.case_name -eq 'f1_gzip' })[0]
    if ((ConvertTo-Json $primaryLogical.metrics -Compress) -ne (ConvertTo-Json $gzipLogical.metrics -Compress)) {
        throw 'Equivalent LF/gzip source bytes produced different graph accounting metrics.'
    }

    $historical = Read-JsonFile -Path (Join-Path $root 'baseline\historical-before.json')
    $preservation = [System.Collections.Generic.List[object]]::new()
    foreach ($record in $historical.historical_publications) {
        $exists = Test-Path -LiteralPath $record.path -PathType Leaf
        $actual = if ($exists) { Get-Item -LiteralPath $record.path } else { $null }
        $hash = if ($exists) { Get-Sha256 -Path $record.path } else { $null }
        $preservation.Add([pscustomobject]@{ path = $record.path; preserved = ($exists -and $actual.Length -eq $record.bytes -and $hash -eq $record.sha256) })
    }
    foreach ($record in $historical.protected_source_files) {
        $exists = Test-Path -LiteralPath $record.path -PathType Leaf
        $actual = if ($exists) { Get-Item -LiteralPath $record.path } else { $null }
        $hash = if ($exists) { Get-Sha256 -Path $record.path } else { $null }
        $preservation.Add([pscustomobject]@{ path = $record.path; preserved = ($exists -and $actual.Length -eq $record.bytes -and $hash -eq $record.sha256) })
    }
    foreach ($record in $sourceBaseline) {
        $path = Join-Path $repo $record.path.Replace('/', '\')
        $exists = Test-Path -LiteralPath $path -PathType Leaf
        $actual = if ($exists) { Get-Item -LiteralPath $path } else { $null }
        $hash = if ($exists) { Get-Sha256 -Path $path } else { $null }
        $preservation.Add([pscustomobject]@{ path = $record.path; preserved = ($exists -and $actual.Length -eq $record.bytes -and $hash -eq $record.sha256) })
    }
    if ($preservation.Where({ -not $_.preserved }).Count -gt 0) { throw 'A protected historical output or original fixture changed during acceptance.' }
    $afterStatus = @(git -C $repo status --porcelain=v1 --untracked-files=all)
    if (Compare-Object @($before.git_status) $afterStatus) { throw 'Repository working-tree status changed during acceptance.' }
    if ((git -C $repo branch --show-current) -ne $before.branch -or (git -C $repo rev-parse HEAD) -ne $before.head) {
        throw 'Repository branch or HEAD changed during acceptance.'
    }
    $afterRuntime = Get-RuntimeBaseline
    if ((Compare-Object $runtimeBefore.volumes $afterRuntime.volumes) -or (Compare-Object $runtimeBefore.all_containers $afterRuntime.all_containers)) {
        throw 'Docker container or volume inventory changed outside invocation-owned --rm containers.'
    }
    if (@(& docker ps -q --filter "label=org.weylume.isn-etl.invocation=$invocationId").Count -gt 0) { throw 'Invocation-owned Docker container remains running.' }
    if (-not (Test-AcceptanceMonitoringClean -MonitoringEvents $monitoringIssues.ToArray())) {
        $failureStatus = 'DOCKER_MONITORING_FAILED'
        $failedMonitorIds = @($monitoringIssues | Where-Object { $_.status -eq 'FAILED' } | ForEach-Object { "$($_.command_id):$($_.operation)=$($_.reason)" })
        throw "Acceptance cannot pass because Docker monitoring failed: $($failedMonitorIds -join '; '). Child exit codes and logs remain recorded in the command evidence."
    }

    $concurrency = [pscustomobject]@{
        publication_process_race = 'PASS: independent processes; exactly one published and one safely rejected.'
        two_spark_cli = 'BLOCKED: no concurrent Spark run started; host free RAM and Docker memory cannot safely support two 4-GiB-limited containers.'
        docker_cpus = $runtimeBefore.docker_cpus
        docker_memory_bytes = $runtimeBefore.docker_memory_bytes
        host_free_memory_bytes_before = $runtimeBefore.host_free_memory_bytes
        per_container_cpu_limit = 2
        per_container_memory_bytes = 4294967296
        per_container_pids_limit = 256
    }
    $warningLines = @()
    foreach ($command in $commands) {
        foreach ($logPath in @((Join-Path $root $command.stdout), (Join-Path $root $command.stderr))) {
            if (Test-Path -LiteralPath $logPath) {
                $warningLines += @(Select-String -LiteralPath $logPath -Pattern 'ResourceWarning|ResourceWarning:|truncated plan|plan string representation' | ForEach-Object { [pscustomobject]@{ command = $command.name; text = $_.Line } })
            }
        }
    }
    $monitoringDisposition = Get-DockerMonitoringDisposition -ChildExitCode 0 -MonitoringEvents $monitoringIssues.ToArray()
    $report = [pscustomobject]@{
        status = 'SCENARIO_EXECUTION_COMPLETE'
        invocation_id = $invocationId
        root = $root
        branch = $before.branch
        head = $before.head
        image = $runtimeBefore.image_inspect
        etl_00_status = $etl00Status
        doctor_execution = $doctorOutcome
        doctor_reuse = $doctorReuseOutcome
        doctor_validation = $doctorValidation
        docker_monitoring = [pscustomobject]@{
            status = $monitoringDisposition.status
            issue_count = $monitoringIssues.Count
            issues = @($monitoringIssues)
        }
        post_doctor_memory_gate = $doctorPostflight
        spark_launch_measurements = @($sparkLaunchMeasurements)
        commands = @($commands)
        containers = @($containers | Sort-Object command_id, started_at -Unique)
        removed_container_records = @($stoppedSnapshots)
        source_variants = @($pins.variants.PSObject.Properties | ForEach-Object { [pscustomobject]@{ name = $_.Name; bytes = $_.Value.source_bytes; sha256 = $_.Value.source_sha256; decoded_bytes = $_.Value.content_bytes; decoded_sha256 = $_.Value.content_sha256; run_id = $_.Value.run_id } })
        successful_cases = @($caseResults)
        independent_verification = 'PASS'
        unit_test_count = [regex]::Matches(($unit.stdout + $unit.stderr), '(?m)^Ran (\d+) tests?$') | ForEach-Object { [int]$_.Groups[1].Value }
        integration_test_count = [regex]::Matches(($integration.stdout + $integration.stderr), '(?m)^Ran (\d+) tests?$') | ForEach-Object { [int]$_.Groups[1].Value }
        concurrency = $concurrency
        warnings = @($warningLines)
        protected_artifacts = @($preservation)
        docker_inventory_unchanged = $true
        invocation_containers_running_at_end = 0
        generated_at = [DateTime]::UtcNow.ToString('o')
    }
    Write-JsonFile -Path (Join-Path $root 'reports\acceptance-evidence.json') -Value $report
    Write-JsonFile -Path (Join-Path $root 'reports\commands.json') -Value @($commands)
    Write-JsonFile -Path (Join-Path $root 'reports\containers.json') -Value @($containers | Sort-Object command_id, started_at -Unique)
    Write-JsonFile -Path (Join-Path $root 'reports\preservation.json') -Value @($preservation)
    Write-Output "Acceptance driver PASS. Invocation root: $root"
    Write-Output "Unit tests=$($report.unit_test_count); integration tests=$($report.integration_test_count); independently verified cases=$($caseResults.Count); Spark concurrency=BLOCKED by capacity."
}
catch {
    $dockerCommandsAtFailure = @($commands | Where-Object { $_.docker_container_command_id })
    $failureMonitoringStatus = if ($dockerCommandsAtFailure.Count -eq 0) {
        'NOT_STARTED'
    } else {
        (Get-DockerMonitoringDisposition -ChildExitCode ([int]$dockerCommandsAtFailure[-1].exit_code) -MonitoringEvents $monitoringIssues.ToArray()).status
    }
    $failure = [pscustomobject]@{
        status = $failureStatus
        invocation_id = $invocationId
        root = $root
        error = ConvertTo-SanitizedText $_.Exception.ToString()
        runtime_preflight = $runtimeBefore
        etl_00_status = $etl00Status
        doctor_execution = $doctorOutcome
        doctor_reuse = $doctorReuseOutcome
        doctor_validation = $doctorValidation
        docker_monitoring = [pscustomobject]@{ status = $failureMonitoringStatus; issues = @($monitoringIssues) }
        requested_doctor_evidence_path = $DoctorEvidencePath
        post_doctor_memory_gate = $doctorPostflight
        spark_launch_measurements = @($sparkLaunchMeasurements)
        commands = @($commands)
        containers = @($containers)
        removed_container_records = @($stoppedSnapshots)
        generated_at = [DateTime]::UtcNow.ToString('o')
    }
    if (Test-Path -LiteralPath $root) { Write-JsonFile -Path (Join-Path $root 'reports\failure.json') -Value $failure }
    [Console]::Error.WriteLine("Acceptance driver failed. Diagnostics retained under $root")
    [Console]::Error.WriteLine((ConvertTo-SanitizedText $_.Exception.Message))
    exit 1
}
