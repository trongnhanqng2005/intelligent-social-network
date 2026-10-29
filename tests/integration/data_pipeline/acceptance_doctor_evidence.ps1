function Get-DoctorEvidenceSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash([System.IO.File]::ReadAllBytes($Path))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Get-DoctorEvidenceTextSha256 {
    param([Parameter(Mandatory = $true)][string]$Text)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Get-DoctorEvidenceContainerLabel {
    param(
        [Parameter(Mandatory = $true)][object]$Labels,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $property = $Labels.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return [string]$property.Value
}

function ConvertFrom-DoctorContainerInspect {
    param(
        [Parameter(Mandatory = $true)][string]$Json,
        [Parameter(Mandatory = $true)][string]$ExpectedContainerId,
        [Parameter(Mandatory = $true)][string]$ExpectedInvocationId,
        [Parameter(Mandatory = $true)][string]$ExpectedCommandId
    )
    if ($ExpectedContainerId -notmatch '^[a-fA-F0-9]{12,64}$') { throw 'docker inspect correlation ID is malformed.' }
    try { $details = @(ConvertFrom-Json -InputObject $Json -ErrorAction Stop) }
    catch { throw "docker inspect returned invalid container JSON: $($_.Exception.Message)" }
    if ($details.Count -ne 1) { throw 'docker inspect must return exactly one container object.' }
    $detail = $details[0]
    if ([string]$detail.Id -notmatch '^[a-fA-F0-9]{64}$' -or
        -not ([string]$detail.Id).StartsWith($ExpectedContainerId, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'docker inspect returned a container ID that does not match the requested container.'
    }
    $invocationLabel = Get-DoctorEvidenceContainerLabel -Labels $detail.Config.Labels -Name 'org.weylume.isn-etl.invocation'
    $commandLabel = Get-DoctorEvidenceContainerLabel -Labels $detail.Config.Labels -Name 'org.weylume.isn-etl.command'
    if ([string]::IsNullOrWhiteSpace($invocationLabel) -or [string]::IsNullOrWhiteSpace($commandLabel) -or
        $invocationLabel -ne $ExpectedInvocationId -or $commandLabel -ne $ExpectedCommandId) {
        throw 'docker inspect is missing or mismatches the expected invocation/command labels.'
    }
    return $detail
}

function Get-CurrentDoctorDockerIdentity {
    $contextName = & docker context show
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$contextName)) { throw 'Cannot establish the active Docker context.' }
    $contextConfiguration = & docker context inspect $contextName --format '{{json .}}'
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$contextConfiguration)) { throw 'Cannot establish the active Docker context configuration.' }
    $daemonValues = & docker info --format '{{.ID}}|{{.ServerVersion}}|{{.NCPU}}|{{.MemTotal}}|{{.OSType}}|{{.Architecture}}'
    if ($LASTEXITCODE -ne 0) { throw 'Docker endpoint unavailable during acceptance preflight.' }
    $versionValues = & docker version --format '{{.Client.Version}}|{{.Server.Version}}'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot establish Docker client/server versions.' }
    $daemon = $daemonValues -split '\|'
    $versions = $versionValues -split '\|'
    if ($daemon.Count -ne 6 -or $versions.Count -ne 2 -or [string]::IsNullOrWhiteSpace($daemon[0])) { throw 'Docker identity response is incomplete.' }

    $dockerExecutable = (Get-Command docker.exe -ErrorAction Stop).Source
    $dockerExecutableHash = Get-DoctorEvidenceSha256 -Path $dockerExecutable
    $powershellExecutable = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $powershellExecutableHash = Get-DoctorEvidenceSha256 -Path $powershellExecutable
    $launcherPowerShellExecutable = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $launcherPowerShellExecutableHash = Get-DoctorEvidenceSha256 -Path $launcherPowerShellExecutable
    $dockerConfig = if ($env:DOCKER_CONFIG) { $env:DOCKER_CONFIG } else { Join-Path $env:USERPROFILE '.docker' }
    $configPath = Join-Path $dockerConfig 'config.json'
    $configHash = if (Test-Path -LiteralPath $configPath -PathType Leaf) { Get-DoctorEvidenceSha256 -Path $configPath } else { 'NO_CONFIG_FILE' }
    $identityText = @(
        [string]$contextName,
        [string]$contextConfiguration,
        [string]$env:DOCKER_HOST,
        [string]$env:DOCKER_CONTEXT,
        [string]$env:DOCKER_CONFIG,
        [string]$configHash
    ) -join "`n"
    return [pscustomobject]@{
        context_name = [string]$contextName
        configuration_sha256 = Get-DoctorEvidenceTextSha256 -Text $identityText
        daemon_id = $daemon[0]
        server_version = $daemon[1]
        client_version = $versions[0]
        docker_cli_sha256 = $dockerExecutableHash
        powershell_version = $PSVersionTable.PSVersion.ToString()
        powershell_executable_sha256 = $powershellExecutableHash
        launcher_powershell_executable_sha256 = $launcherPowerShellExecutableHash
        cpus = [int]$daemon[2]
        memory_bytes = [long]$daemon[3]
        os = $daemon[4]
        architecture = $daemon[5]
    }
}

function Get-DoctorSourceFingerprints {
    param([Parameter(Mandatory = $true)][string]$Repository)
    $paths = @(
        'tests/integration/data_pipeline/acceptance.ps1',
        'tests/integration/data_pipeline/acceptance_doctor_evidence.ps1',
        'tests/integration/data_pipeline/acceptance_docker_monitoring.ps1',
        'tests/integration/data_pipeline/acceptance_resource_gate.ps1',
        'scripts/data-pipeline.ps1',
        'data-pipeline/Dockerfile',
        'data-pipeline/pyproject.toml',
        'data-pipeline/requirements.lock',
        'data-pipeline/config/snap-facebook-combined.json'
    )
    $paths += @(Get-ChildItem -LiteralPath (Join-Path $Repository 'data-pipeline/src/isn_etl') -Recurse -File -Filter '*.py' | ForEach-Object { $_.FullName.Substring($Repository.Length).TrimStart('\', '/').Replace('\', '/') })
    foreach ($relativePath in $paths | Sort-Object -Unique) {
        $fullPath = Join-Path $Repository $relativePath.Replace('/', '\')
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Doctor compatibility source/configuration file is missing: $relativePath" }
        [pscustomobject]@{ path = $relativePath; sha256 = Get-DoctorEvidenceSha256 -Path $fullPath }
    }
}

function Get-DoctorEvidenceArtifactPath {
    param([Parameter(Mandatory = $true)][string]$Root, [Parameter(Mandatory = $true)][string]$RelativePath)
    if ([System.IO.Path]::IsPathRooted($RelativePath)) { throw 'Evidence log path must be relative to its artifact root.' }
    $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $fullRoot $RelativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)))
    if (-not $fullPath.StartsWith($fullRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Evidence log path escapes its artifact root.'
    }
    return $fullPath
}

function Test-DoctorEvidence {
    param(
        [Parameter(Mandatory = $true)][string]$EvidencePath,
        [Parameter(Mandatory = $true)][string]$ExpectedImage,
        [Parameter(Mandatory = $true)][object]$CurrentImage,
        [Parameter(Mandatory = $true)][object]$CurrentDocker,
        [Parameter(Mandatory = $true)][object]$CurrentLimits,
        [Parameter(Mandatory = $true)][object]$CurrentRuntimeDependencies,
        [Parameter(Mandatory = $true)][object[]]$CurrentSourceFingerprints,
        [Parameter(Mandatory = $true)][string]$CurrentRepository,
        [Parameter(Mandatory = $true)][string]$CurrentBranch,
        [Parameter(Mandatory = $true)][string]$CurrentHead,
        [Parameter(Mandatory = $true)][long]$CurrentHostFreeBytes,
        [Parameter(Mandatory = $true)][long]$MinimumHostFreeBytes,
        [string[]]$RunningContainers = @(),
        [string[]]$ConflictingProcesses = @(),
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$CurrentAllContainerIds
    )

    $checks = [System.Collections.Generic.List[string]]::new()
    $reasons = [System.Collections.Generic.List[string]]::new()
    if ($CurrentHostFreeBytes -lt $MinimumHostFreeBytes) { $reasons.Add("Current host RAM is below the launch gate ($CurrentHostFreeBytes < $MinimumHostFreeBytes bytes).") }
    else { $checks.Add('Current host RAM meets the launch gate.') }
    if (@($RunningContainers).Count -gt 0) { $reasons.Add("Conflicting Docker containers are active: $(@($RunningContainers) -join ', ').") }
    else { $checks.Add('No Docker containers are active.') }
    if (@($ConflictingProcesses).Count -gt 0) { $reasons.Add("Conflicting acceptance/Spark processes are active: $(@($ConflictingProcesses) -join ', ').") }
    else { $checks.Add('No conflicting acceptance/Spark processes are active.') }
    if ($CurrentImage.reference -ne $ExpectedImage -or $CurrentImage.id -notmatch '^sha256:[a-fA-F0-9]{64}$' -or $CurrentImage.os -ne 'linux' -or $CurrentImage.architecture -ne 'amd64' -or $CurrentImage.user -ne '10001:10001') {
        $reasons.Add('Current pinned Docker image identity/platform/user is missing or invalid.')
    } else { $checks.Add('Current pinned Docker image digest/platform/user were verified.') }
    $currentDockerFields = @('context_name', 'configuration_sha256', 'daemon_id', 'server_version', 'client_version', 'docker_cli_sha256', 'powershell_version', 'powershell_executable_sha256', 'launcher_powershell_executable_sha256', 'cpus', 'memory_bytes', 'os', 'architecture')
    $missingCurrentDocker = @($currentDockerFields | Where-Object { [string]::IsNullOrWhiteSpace([string]$CurrentDocker.$_) })
    if ($missingCurrentDocker.Count -gt 0) { $reasons.Add("Current Docker identity/configuration is incomplete: $($missingCurrentDocker -join ', ').") }
    elseif ($CurrentDocker.cpus -lt 2 -or $CurrentDocker.memory_bytes -lt 4294967296 -or $CurrentDocker.os -ne 'linux' -or $CurrentDocker.architecture -ne 'x86_64') {
        $reasons.Add('Current Docker capacity or platform does not satisfy the approved Spark runtime contract.')
    } else { $checks.Add('Current Docker context/configuration/daemon and required capacity were read successfully.') }
    foreach ($hashField in @('configuration_sha256', 'docker_cli_sha256')) {
        if ([string]$CurrentDocker.$hashField -notmatch '^[a-fA-F0-9]{64}$') { $reasons.Add("Current Docker '$hashField' is not a valid SHA-256 fingerprint.") }
    }

    if (-not (Test-Path -LiteralPath $EvidencePath -PathType Leaf)) {
        $reasons.Add("Doctor evidence file is missing: $EvidencePath")
        return [pscustomobject]@{ eligible = $false; evidence_reference = $EvidencePath; doctor_invocation_id = $null; compatible_checks = @($checks.ToArray()); reasons = @($reasons.ToArray()) }
    }

    try {
        $document = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($EvidencePath, [System.Text.UTF8Encoding]::new($false, $true)))
    } catch {
        $reasons.Add("Doctor evidence JSON is malformed or unreadable: $($_.Exception.Message)")
        return [pscustomobject]@{ eligible = $false; evidence_reference = $EvidencePath; doctor_invocation_id = $null; compatible_checks = @($checks.ToArray()); reasons = @($reasons.ToArray()) }
    }

    if ($null -eq $document.schema_version) {
        if ($null -ne $document.commands -and $null -ne $document.runtime_preflight) {
            $legacy = Test-LegacyDoctorEvidence -Document $document -EvidencePath $EvidencePath -ExpectedImage $ExpectedImage -CurrentImage $CurrentImage
            foreach ($check in $legacy.checks) { $checks.Add($check) }
            foreach ($reason in $legacy.reasons) { $reasons.Add($reason) }
            return [pscustomobject]@{ eligible = $false; evidence_reference = $EvidencePath; doctor_invocation_id = $document.invocation_id; compatible_checks = @($checks.ToArray()); reasons = @($reasons.ToArray()) }
        }
        $reasons.Add('Doctor evidence is incomplete: schema_version is missing and the document is not a recognized acceptance-driver report.')
        return [pscustomobject]@{ eligible = $false; evidence_reference = $EvidencePath; doctor_invocation_id = $null; compatible_checks = @($checks.ToArray()); reasons = @($reasons.ToArray()) }
    }

    foreach ($field in @('result', 'invocation_id', 'artifact_root', 'repository', 'branch', 'head', 'captured_at_utc', 'image', 'docker', 'limits', 'runtime_dependencies', 'source_fingerprints', 'command', 'container', 'container_cleanup', 'logs')) {
        if ($null -eq $document.$field) { $reasons.Add("Doctor evidence is incomplete: required field '$field' is missing.") }
    }
    if ($reasons.Count -gt 0) {
        return [pscustomobject]@{ eligible = $false; evidence_reference = $EvidencePath; doctor_invocation_id = $document.invocation_id; compatible_checks = @($checks.ToArray()); reasons = @($reasons.ToArray()) }
    }

    $schemaVersion = 0
    if (-not [int]::TryParse([string]$document.schema_version, [ref]$schemaVersion) -or $schemaVersion -ne 1) {
        $reasons.Add("Unsupported or malformed Doctor evidence schema_version '$($document.schema_version)'.")
    }
    if ($document.result -ne 'PASS') { $reasons.Add("Doctor evidence result is '$($document.result)', not PASS.") }
    if ($document.invocation_id -notmatch '^[a-fA-F0-9]{32}$') { $reasons.Add('Doctor evidence invocation_id is malformed.') }
    $artifactRoot = [System.IO.Path]::GetFullPath([string]$document.artifact_root).TrimEnd('\', '/')
    $expectedRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent $EvidencePath))).TrimEnd('\', '/')
    if (-not [string]::Equals($artifactRoot, $expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { $reasons.Add('Doctor evidence artifact_root does not match its report location.') }
    if ($document.repository -ne $CurrentRepository -or $document.branch -ne $CurrentBranch -or $document.head -ne $CurrentHead) {
        $reasons.Add('Doctor evidence repository, branch, or HEAD differs from the current acceptance worktree.')
    } else { $checks.Add('Repository, branch, and HEAD match the Doctor evidence.') }

    $recordedImage = $document.image
    if ($recordedImage.reference -ne $ExpectedImage -or $CurrentImage.reference -ne $ExpectedImage -or
        $recordedImage.id -ne $CurrentImage.id -or $recordedImage.os -ne 'linux' -or
        $recordedImage.architecture -ne 'amd64' -or $recordedImage.user -ne '10001:10001' -or
        $CurrentImage.os -ne 'linux' -or $CurrentImage.architecture -ne 'amd64' -or $CurrentImage.user -ne '10001:10001') {
        $reasons.Add('Pinned Docker image reference, digest, OS, architecture, or user differs from the Doctor evidence.')
    } else { $checks.Add('Pinned Docker image digest and platform match.') }

    $dockerReasonCountBefore = $reasons.Count
    foreach ($field in @('context_name', 'configuration_sha256', 'daemon_id', 'server_version', 'client_version', 'docker_cli_sha256', 'powershell_version', 'powershell_executable_sha256', 'launcher_powershell_executable_sha256', 'os', 'architecture')) {
        if ($null -eq $document.docker.$field) { $reasons.Add("Doctor evidence is incomplete: historical Docker '$field' is missing."); continue }
        if ($null -eq $CurrentDocker.$field) { $reasons.Add("Current Docker '$field' could not be established."); continue }
        if ($document.docker.$field -ne $CurrentDocker.$field) { $reasons.Add("Docker $field differs from the recorded Doctor environment.") }
    }
    foreach ($hashField in @('configuration_sha256', 'docker_cli_sha256', 'powershell_executable_sha256', 'launcher_powershell_executable_sha256')) {
        if ([string]$document.docker.$hashField -notmatch '^[a-fA-F0-9]{64}$') { $reasons.Add("Historical Docker '$hashField' is not a valid SHA-256 fingerprint.") }
    }
    if ($null -eq $document.docker.cpus -or $document.docker.cpus -lt 2 -or
        $null -eq $document.docker.memory_bytes -or $document.docker.memory_bytes -lt 4294967296) {
        $reasons.Add('Historical Docker CPU/memory capacity did not satisfy the approved Spark runtime contract.')
    }
    $hasRecordedDockerIdentity = $true
    foreach ($field in @('context_name', 'configuration_sha256', 'daemon_id', 'server_version', 'client_version', 'docker_cli_sha256', 'powershell_version', 'powershell_executable_sha256', 'launcher_powershell_executable_sha256')) {
        if ([string]::IsNullOrWhiteSpace([string]$document.docker.$field)) { $hasRecordedDockerIdentity = $false }
    }
    if ($CurrentDocker.cpus -lt 2 -or $CurrentDocker.memory_bytes -lt 4294967296 -or $CurrentDocker.os -ne 'linux' -or $CurrentDocker.architecture -ne 'x86_64') {
        $reasons.Add('Current Docker capacity or platform does not satisfy the approved Spark runtime contract.')
    } elseif ($hasRecordedDockerIdentity -and $reasons.Count -eq $dockerReasonCountBefore) {
        $checks.Add('Docker context, configuration, daemon identity, version, capacity, and platform match.')
    }

    foreach ($field in @('cpus', 'memory_bytes', 'pids_limit', 'network')) {
        if ($null -eq $document.limits.$field -or $null -eq $CurrentLimits.$field -or $document.limits.$field -ne $CurrentLimits.$field) {
            $reasons.Add("Approved per-container resource/environment limit '$field' is missing or differs from the current contract.")
        }
    }
    if ($document.limits.cpus -ne 2 -or $document.limits.memory_bytes -ne 4294967296 -or $document.limits.pids_limit -ne 256 -or $document.limits.network -ne 'none') {
        $reasons.Add('Doctor evidence does not record the approved 2-CPU/4-GiB/256-PID/no-network contract.')
    } else { $checks.Add('Approved per-container resource limits match.') }

    foreach ($field in @('python', 'pyspark', 'py4j', 'java', 'spark', 'master')) {
        if ($null -eq $document.runtime_dependencies.$field -or $null -eq $CurrentRuntimeDependencies.$field -or
            $document.runtime_dependencies.$field -ne $CurrentRuntimeDependencies.$field) {
            $reasons.Add("Required runtime dependency '$field' is missing or differs from the current contract.")
        }
    }
    if ($document.runtime_dependencies.python -ne '3.12.15' -or $document.runtime_dependencies.pyspark -ne '3.5.9' -or
        $document.runtime_dependencies.py4j -ne '0.10.9.7' -or $document.runtime_dependencies.java -ne '17.0.20.1' -or
        $document.runtime_dependencies.spark -ne '3.5.9' -or $document.runtime_dependencies.master -ne 'local[2]') {
        $reasons.Add('Doctor evidence runtime dependency versions do not match the approved runtime contract.')
    } else { $checks.Add('Required Python, PySpark, Py4J, Java, and Spark versions match.') }

    if (@($document.source_fingerprints).Count -eq 0 -or @($CurrentSourceFingerprints).Count -eq 0) {
        $reasons.Add('Historical or current runtime source/configuration fingerprints are missing.')
    } else {
        $badFingerprints = @($document.source_fingerprints | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.path) -or [string]$_.sha256 -notmatch '^[a-fA-F0-9]{64}$' })
        if ($badFingerprints.Count -gt 0) { $reasons.Add('Runtime source/configuration fingerprints contain an invalid path or SHA-256 value.') }
        $recordedFingerprints = @($document.source_fingerprints | Sort-Object path | ForEach-Object { "$($_.path)=$($_.sha256)" })
        $currentFingerprints = @($CurrentSourceFingerprints | Sort-Object path | ForEach-Object { "$($_.path)=$($_.sha256)" })
        if ((ConvertTo-Json $recordedFingerprints -Compress) -ne (ConvertTo-Json $currentFingerprints -Compress)) {
            $reasons.Add('Runtime source/configuration fingerprints differ from the Doctor-time fingerprints.')
        } else { $checks.Add('Runtime source and configuration fingerprints match.') }
    }

    $command = $document.command
    $doctorExitCode = -1
    $validDoctorExitCode = [int]::TryParse([string]$command.exit_code, [ref]$doctorExitCode)
    if ($command.name -ne 'doctor' -or -not $validDoctorExitCode -or $doctorExitCode -ne 0 -or
        $command.command_id -ne $document.container.command_id -or $command.container_id -ne $document.container.container_id -or
        @($command.arguments | Where-Object { $_ -eq 'doctor' }).Count -ne 1) {
        $reasons.Add('Doctor command completion, arguments, exit code, or container correlation is invalid.')
    } else { $checks.Add('A completed Doctor command with exit code 0 is correlated to its container.') }
    try {
        $started = [DateTimeOffset]::Parse([string]$command.started_at_utc)
        $finished = [DateTimeOffset]::Parse([string]$command.finished_at_utc)
        $captured = [DateTimeOffset]::Parse([string]$document.captured_at_utc)
        if ($started -gt $finished -or $finished -gt $captured -or $captured -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) { throw 'timestamps are inconsistent' }
    } catch { $reasons.Add("Doctor evidence command/capture timestamps are invalid: $($_.Exception.Message)") }

    $container = $document.container
    if ([string]$container.container_id -notmatch '^[a-fA-F0-9]{64}$' -or
        $container.command_id -ne $command.command_id -or
        $container.image_id -ne $CurrentImage.id -or $container.status -notin @('running', 'exited') -or
        $container.cpus -ne 2 -or $container.memory_bytes -ne 4294967296 -or $container.pids_limit -ne 256 -or $container.network_mode -ne 'none') {
        $reasons.Add('Observed Doctor container image, status, or resource configuration is invalid.')
    } elseif (-not (@($container.mounts | Where-Object { $_.destination -eq '/workspace' -and -not $_.read_write }).Count -eq 1)) {
        $reasons.Add('Observed Doctor container did not mount the repository workspace read-only.')
    } else { $checks.Add('Observed Doctor container used the pinned image, approved limits, and read-only workspace.') }
    if ([string]::IsNullOrWhiteSpace([string]$container.labels.invocation_id) -or
        [string]::IsNullOrWhiteSpace([string]$container.labels.command_id) -or
        $container.labels.invocation_id -ne $document.invocation_id -or $container.labels.command_id -ne $command.command_id) {
        $reasons.Add('Observed Docker labels do not bind the Doctor container to this invocation and command.')
    } else { $checks.Add('Observed Docker invocation/command labels match the evidence record.') }
    if ($document.container_cleanup.command_id -ne $command.command_id -or
        $document.container_cleanup.removed_after_exit -ne $true -or $document.container_cleanup.cidfile_id -ne $container.container_id -or
        $document.container_cleanup.final_status -ne 'removed-by---rm' -or @($CurrentAllContainerIds | Where-Object { $_ -eq $container.container_id }).Count -gt 0) {
        $reasons.Add('Doctor container cidfile/removal evidence is incomplete or the invocation container is still present.')
    } else { $checks.Add('Doctor container cidfile matched and --rm teardown is confirmed.') }

    foreach ($kind in @('stdout', 'stderr')) {
        $pathField = "${kind}_path"
        $hashField = "${kind}_sha256"
        if ($null -eq $document.logs.$pathField -or $document.logs.$hashField -notmatch '^[a-fA-F0-9]{64}$') {
            $reasons.Add("Doctor $kind log path or integrity hash is missing/invalid.")
            continue
        }
        try {
            $logPath = Get-DoctorEvidenceArtifactPath -Root $artifactRoot -RelativePath ([string]$document.logs.$pathField)
            if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) { throw 'file is missing' }
            if ((Get-DoctorEvidenceSha256 -Path $logPath) -ne $document.logs.$hashField.ToLowerInvariant()) { throw 'SHA-256 does not match' }
            if ($kind -eq 'stdout') {
                $text = [System.IO.File]::ReadAllText($logPath, [System.Text.UTF8Encoding]::new($false, $true))
                foreach ($requiredText in @('DOCKER_SPARK_PARQUET_SMOKE=PASS', 'Python: 3.12.15', 'PySpark: 3.5.9; Py4J: 0.10.9.7', 'Java: 17.0.20.1; Spark: 3.5.9; master=local[2]', 'Python worker: PASS', 'Snappy Parquet footer/readback: PASS')) {
                    if (-not $text.Contains($requiredText)) { throw "required Doctor output is absent: $requiredText" }
                }
            }
        } catch { $reasons.Add("Doctor $kind log validation failed: $($_.Exception.Message)") }
    }
    if ($reasons.Count -eq 0) { $checks.Add('Doctor stdout/stderr are present, hash-verified, and contain all required PASS/runtime evidence.') }

    return [pscustomobject]@{
        eligible = ($reasons.Count -eq 0)
        evidence_reference = $EvidencePath
        doctor_invocation_id = $document.invocation_id
        compatible_checks = @($checks.ToArray())
        reasons = @($reasons.ToArray())
    }
}

function Test-LegacyDoctorEvidence {
    param([object]$Document, [string]$EvidencePath, [string]$ExpectedImage, [object]$CurrentImage)
    $checks = [System.Collections.Generic.List[string]]::new()
    $reasons = [System.Collections.Generic.List[string]]::new()
    $root = [string]$Document.root
    $commands = @($Document.commands | Where-Object { $_.name -eq 'doctor' })
    if ($commands.Count -ne 1) {
        $reasons.Add('Historical report does not contain exactly one Doctor command record.')
    } else {
        $command = $commands[0]
        $snapshot = @($Document.containers | Where-Object { $_.command_id -eq $command.docker_container_command_id } | Select-Object -First 1)
        if ([int]$command.exit_code -ne 0 -or @($command.arguments | Where-Object { $_ -eq 'doctor' }).Count -ne 1 -or $snapshot.Count -ne 1) {
            $reasons.Add('Historical Doctor command exit/arguments/container correlation is incomplete.')
        } else {
            $stdout = $null
            try {
                $stdoutPath = Get-DoctorEvidenceArtifactPath -Root $root -RelativePath ([string]$command.stdout)
                $stderrPath = Get-DoctorEvidenceArtifactPath -Root $root -RelativePath ([string]$command.stderr)
                if (-not (Test-Path -LiteralPath $stdoutPath -PathType Leaf) -or -not (Test-Path -LiteralPath $stderrPath -PathType Leaf)) { throw 'Doctor stdout or stderr file is missing' }
                $stdout = [System.IO.File]::ReadAllText($stdoutPath, [System.Text.UTF8Encoding]::new($false, $true))
                foreach ($requiredText in @('DOCKER_SPARK_PARQUET_SMOKE=PASS', 'Python: 3.12.15', 'PySpark: 3.5.9; Py4J: 0.10.9.7', 'Java: 17.0.20.1; Spark: 3.5.9; master=local[2]', 'Python worker: PASS', 'Snappy Parquet footer/readback: PASS')) {
                    if (-not $stdout.Contains($requiredText)) { throw "required Doctor output is absent: $requiredText" }
                }
                $checks.Add('Historical Doctor exit 0, linked stdout/stderr, smoke marker, dependency versions, and container record were verified.')
            } catch { $reasons.Add("Historical Doctor completion evidence is incomplete: $($_.Exception.Message)") }
            if ($snapshot.Count -eq 1) {
                $container = $snapshot[0]
                if ($container.image_id -ne $CurrentImage.id -or $container.cpus -ne 2 -or $container.memory_bytes -ne 4294967296 -or $container.pids_limit -ne 256 -or $container.network_mode -ne 'none') {
                    $reasons.Add('Historical Doctor container image/resource contract differs from current pinned runtime.')
                } elseif ($Document.runtime_preflight.image -ne $ExpectedImage -or $Document.runtime_preflight.image_inspect -notmatch ('^' + [regex]::Escape($CurrentImage.id) + '\|linux\|amd64\|10001:10001$')) {
                    $reasons.Add('Historical preflight pinned image identity does not match current local image.')
                } else {
                    $checks.Add('Historical and current pinned image digest and Doctor container resource limits match.')
                }
            }
        }
    }

    $baselinePath = Join-Path $root 'baseline\before.json'
    if (Test-Path -LiteralPath $baselinePath -PathType Leaf) {
        try {
            $baseline = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($baselinePath, [System.Text.UTF8Encoding]::new($false, $true)))
            if ($baseline.invocation_id -ne $Document.invocation_id -or $baseline.root -ne $root) { $reasons.Add('Historical baseline is not associated with the Doctor invocation.') }
        } catch { $reasons.Add("Historical baseline is malformed: $($_.Exception.Message)") }
    } else { $reasons.Add('Historical invocation baseline file is missing.') }

    foreach ($missing in @(
        'Docker context name and effective context/configuration fingerprint at Doctor time',
        'Docker daemon/client versions, Docker CLI, orchestrator/launcher PowerShell executable SHA-256, and PowerShell version at Doctor time',
        'Runtime source/configuration SHA-256 fingerprints captured at Doctor time',
        'Doctor stdout and stderr SHA-256 values bound to the report',
        'Post-command Docker cidfile/container-removal state in the evidence report'
    )) { $reasons.Add("Historical evidence is insufficient: missing $missing.") }
    return [pscustomobject]@{ checks = @($checks.ToArray()); reasons = @($reasons.ToArray()) }
}

function Resolve-DoctorExecution {
    param([AllowEmptyString()][string]$EvidencePath, [Parameter(Mandatory = $true)][object]$Validation)
    if (-not $EvidencePath) { return [pscustomobject]@{ mode = 'EXECUTE'; execute_doctor = $true; allow_spark = $false; reasons = @() } }
    if (-not $Validation.eligible) { return [pscustomobject]@{ mode = 'REJECTED'; execute_doctor = $false; allow_spark = $false; reasons = @($Validation.reasons) } }
    return [pscustomobject]@{ mode = 'REUSED'; execute_doctor = $false; allow_spark = $true; reasons = @() }
}

function Get-DoctorEvidenceImmediateDisposition {
    param([Parameter(Mandatory = $true)][object]$Validation)
    if ($Validation.eligible) { return 'VALIDATED' }
    $ramReasons = @($Validation.reasons | Where-Object { $_ -match '^Current host RAM is below the launch gate \(' })
    $otherReasons = @($Validation.reasons | Where-Object { $_ -notmatch '^Current host RAM is below the launch gate \(' })
    if ($ramReasons.Count -gt 0 -and $otherReasons.Count -eq 0) { return 'COMPATIBLE_AWAITING_RAM_GATE' }
    return 'REJECTED'
}

function New-DoctorOutcome {
    param([ValidateSet('EXECUTED', 'REUSED', 'REJECTED')][string]$Mode, [object]$Validation, [string]$EvidencePath, [bool]$DoctorPassed = $true)
    $etlStatus = switch ($Mode) {
        'EXECUTED' {
            if (-not $DoctorPassed) { 'FAIL_FRESH_DOCKER_DOCTOR' }
            elseif ($Validation.eligible) { 'PASS_FRESH_DOCKER_DOCTOR' }
            elseif ($Validation.validation_status -eq 'NOT_RUN_IMMEDIATE_POST_DOCTOR_VALIDATION') { 'PENDING_STRICT_DOCKER_EVIDENCE_VALIDATION' }
            elseif ((Get-DoctorEvidenceImmediateDisposition -Validation $Validation) -eq 'COMPATIBLE_AWAITING_RAM_GATE') { 'BLOCKED_POST_DOCTOR_HOST_RAM' }
            else { 'FAIL_FRESH_DOCKER_EVIDENCE_VALIDATION' }
        }
        'REUSED' { 'PASS_REUSED_DOCKER_DOCTOR' }
        'REJECTED' { 'BLOCKED_REJECTED_DOCKER_DOCTOR_EVIDENCE' }
    }
    return [pscustomobject]@{
        status = $Mode
        result = if ($Mode -eq 'REJECTED') { 'BLOCKED' } elseif ($Mode -eq 'EXECUTED' -and -not $DoctorPassed) { 'FAIL' } else { 'PASS' }
        etl_00_status = $etlStatus
        evidence_validation_status = if ($Validation.validation_status) { $Validation.validation_status } elseif ($Validation.eligible) { 'VALIDATED' } else { 'REJECTED' }
        doctor_invocation_executed = ($Mode -eq 'EXECUTED')
        doctor_invocation_id = $Validation.doctor_invocation_id
        evidence_path = $EvidencePath
        original_evidence_path = if ($Mode -eq 'REUSED') { $EvidencePath } else { $null }
        compatible_checks = @($Validation.compatible_checks)
        rejection_reasons = @($Validation.reasons)
    }
}

function New-DoctorEvidenceRecord {
    param(
        [string]$ArtifactRoot,
        [string]$InvocationId,
        [string]$Repository,
        [string]$Branch,
        [string]$Head,
        [object]$Image,
        [object]$Docker,
        [object]$Limits,
        [object]$RuntimeDependencies,
        [object[]]$SourceFingerprints,
        [object]$Command,
        [object]$Container,
        [object]$ContainerCleanup
    )
    $stdoutPath = Get-DoctorEvidenceArtifactPath -Root $ArtifactRoot -RelativePath $Command.stdout
    $stderrPath = Get-DoctorEvidenceArtifactPath -Root $ArtifactRoot -RelativePath $Command.stderr
    $stdout = [System.IO.File]::ReadAllText($stdoutPath, [System.Text.UTF8Encoding]::new($false, $true))
    $doctorPassed = ([int]$Command.exit_code -eq 0 -and $stdout.Contains('DOCKER_SPARK_PARQUET_SMOKE=PASS'))
    return [pscustomobject]@{
        schema_version = 1
        result = if ($doctorPassed) { 'PASS' } else { 'FAIL' }
        invocation_id = $InvocationId
        artifact_root = [System.IO.Path]::GetFullPath($ArtifactRoot)
        repository = $Repository
        branch = $Branch
        head = $Head
        captured_at_utc = [DateTime]::UtcNow.ToString('o')
        image = $Image
        docker = $Docker
        limits = $Limits
        runtime_dependencies = $RuntimeDependencies
        source_fingerprints = @($SourceFingerprints)
        command = [pscustomobject]@{
            name = 'doctor'
            arguments = @($Command.arguments)
            exit_code = [int]$Command.exit_code
            started_at_utc = $Command.started_at
            finished_at_utc = $Command.finished_at
            command_id = $Command.docker_container_command_id
            container_id = $Container.container_id
        }
        container = [pscustomobject]@{
            command_id = $Container.command_id
            container_id = $Container.container_id
            image_id = $Container.image_id
            labels = [pscustomobject]@{ invocation_id = $Container.invocation_label; command_id = $Container.command_label }
            status = $Container.status
            cpus = $Container.cpus
            memory_bytes = $Container.memory_bytes
            pids_limit = $Container.pids_limit
            network_mode = $Container.network_mode
            mounts = @($Container.mounts)
        }
        container_cleanup = $ContainerCleanup
        logs = [pscustomobject]@{
            stdout_path = $Command.stdout
            stdout_sha256 = Get-DoctorEvidenceSha256 -Path $stdoutPath
            stderr_path = $Command.stderr
            stderr_sha256 = Get-DoctorEvidenceSha256 -Path $stderrPath
        }
    }
}
