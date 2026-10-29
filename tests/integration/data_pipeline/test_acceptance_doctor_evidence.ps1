$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'acceptance_doctor_evidence.ps1')

$script:assertions = 0

function Assert-True {
    param([bool]$Value, [string]$Message)
    $script:assertions++
    if (-not $Value) { throw $Message }
}

function New-TestEvidenceBundle {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) "isn-etl-doctor-test-$([guid]::NewGuid().ToString('N'))"
    [System.IO.Directory]::CreateDirectory((Join-Path $root 'logs')) | Out-Null
    [System.IO.Directory]::CreateDirectory((Join-Path $root 'reports')) | Out-Null
    $stdoutPath = Join-Path $root 'logs\001-doctor.stdout.txt'
    $stderrPath = Join-Path $root 'logs\001-doctor.stderr.txt'
    $stdout = @'
Linux: 6.18.33.2-microsoft-standard-WSL2 x86_64
Python: 3.12.15
PySpark: 3.5.9; Py4J: 0.10.9.7
Java: 17.0.20.1; Spark: 3.5.9; master=local[2]
Python worker: PASS
Snappy Parquet footer/readback: PASS codec=['SNAPPY']
DOCKER_SPARK_PARQUET_SMOKE=PASS
'@
    [System.IO.File]::WriteAllText($stdoutPath, $stdout, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText($stderrPath, 'Spark startup warning', [System.Text.UTF8Encoding]::new($false))
    $sourceFingerprints = @([pscustomobject]@{ path = 'scripts/data-pipeline.ps1'; sha256 = 'a' * 64 })
    $finishedAt = [DateTime]::UtcNow
    $evidence = [pscustomobject]@{
        schema_version = 1
        result = 'PASS'
        invocation_id = '11111111111111111111111111111111'
        artifact_root = $root
        repository = 'D:\repo'
        branch = 'feature/data-ingestion-spark-etl'
        head = '2222222222222222222222222222222222222222'
        captured_at_utc = $finishedAt.AddSeconds(1).ToString('o')
        image = [pscustomobject]@{ reference = 'isn-b-data-pipeline:py3.12-pyspark3.5.9-runtime-snappy'; id = 'sha256:' + ('b' * 64); os = 'linux'; architecture = 'amd64'; user = '10001:10001' }
        docker = [pscustomobject]@{ context_name = 'desktop-linux'; configuration_sha256 = 'c' * 64; daemon_id = 'docker-daemon-test'; server_version = '29.8.2'; client_version = '29.8.2'; docker_cli_sha256 = 'f' * 64; powershell_version = '5.1.19041.5247'; powershell_executable_sha256 = '9' * 64; launcher_powershell_executable_sha256 = '8' * 64; cpus = 24; memory_bytes = 8176463872; os = 'linux'; architecture = 'x86_64' }
        limits = [pscustomobject]@{ cpus = 2; memory_bytes = 4294967296; pids_limit = 256; network = 'none' }
        runtime_dependencies = [pscustomobject]@{ python = '3.12.15'; pyspark = '3.5.9'; py4j = '0.10.9.7'; java = '17.0.20.1'; spark = '3.5.9'; master = 'local[2]' }
        source_fingerprints = $sourceFingerprints
        command = [pscustomobject]@{ name = 'doctor'; arguments = @('doctor'); exit_code = 0; started_at_utc = $finishedAt.AddMinutes(-1).ToString('o'); finished_at_utc = $finishedAt.ToString('o'); command_id = 'c001'; container_id = 'd' * 64 }
        container = [pscustomobject]@{ command_id = 'c001'; container_id = 'd' * 64; image_id = 'sha256:' + ('b' * 64); status = 'running'; cpus = 2; memory_bytes = 4294967296; pids_limit = 256; network_mode = 'none'; labels = [pscustomobject]@{ invocation_id = '11111111111111111111111111111111'; command_id = 'c001' }; mounts = @([pscustomobject]@{ destination = '/workspace'; read_write = $false }) }
         container_cleanup = [pscustomobject]@{ command_id = 'c001'; cidfile_id = 'd' * 64; removed_after_exit = $true; final_status = 'removed-by---rm' }
        logs = [pscustomobject]@{ stdout_path = 'logs/001-doctor.stdout.txt'; stdout_sha256 = (Get-DoctorEvidenceSha256 $stdoutPath); stderr_path = 'logs/001-doctor.stderr.txt'; stderr_sha256 = (Get-DoctorEvidenceSha256 $stderrPath) }
    }
    $evidencePath = Join-Path $root 'reports\doctor-evidence.json'
    $evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $evidencePath -Encoding UTF8
    return [pscustomobject]@{ root = $root; evidence_path = $evidencePath; evidence = $evidence; source_fingerprints = $sourceFingerprints }
}

function New-TestValidationArguments {
    param([Parameter(Mandatory = $true)][object]$Bundle)
    return @{
        EvidencePath = $Bundle.evidence_path
        ExpectedImage = 'isn-b-data-pipeline:py3.12-pyspark3.5.9-runtime-snappy'
        CurrentImage = $Bundle.evidence.image
        CurrentDocker = $Bundle.evidence.docker
        CurrentLimits = [pscustomobject]@{ cpus = 2; memory_bytes = 4294967296; pids_limit = 256; network = 'none' }
        CurrentRuntimeDependencies = $Bundle.evidence.runtime_dependencies
        CurrentSourceFingerprints = $Bundle.source_fingerprints
        CurrentRepository = 'D:\repo'
        CurrentBranch = $Bundle.evidence.branch
        CurrentHead = $Bundle.evidence.head
        CurrentHostFreeBytes = [long]6000000000
        MinimumHostFreeBytes = [long]4831838208
        RunningContainers = @()
        ConflictingProcesses = @()
        CurrentAllContainerIds = @()
    }
}

function Remove-TestBundle {
    param([Parameter(Mandatory = $true)][string]$Root)
    Remove-Item -LiteralPath $Root -Recurse -Force
}

$repository = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$runtimeFingerprintPaths = @(Get-DoctorSourceFingerprints -Repository $repository | ForEach-Object { $_.path })
Assert-True ($runtimeFingerprintPaths -contains 'scripts/data-pipeline.ps1' -and $runtimeFingerprintPaths -contains 'data-pipeline/Dockerfile') 'Doctor compatibility fingerprints must include the actual launcher and pinned runtime image definition.'
Assert-True ($runtimeFingerprintPaths -contains 'tests/integration/data_pipeline/acceptance.ps1' -and $runtimeFingerprintPaths -contains 'tests/integration/data_pipeline/acceptance_doctor_evidence.ps1' -and $runtimeFingerprintPaths -contains 'tests/integration/data_pipeline/acceptance_docker_monitoring.ps1' -and $runtimeFingerprintPaths -contains 'tests/integration/data_pipeline/acceptance_resource_gate.ps1') 'Doctor evidence must fingerprint its relevant producer, validator, monitoring and resource-gate logic.'
Assert-True (@($runtimeFingerprintPaths | Where-Object { $_ -match 'acceptance\.md|test_acceptance|task/data-ingestion-spark-etl|reports|fixtures' }).Count -eq 0) 'Mutable reports, tests, checklists and fixture artifacts must not invalidate runtime compatibility evidence.'
$dockerLabels = '{"org.weylume.isn-etl.invocation":"11111111111111111111111111111111","org.weylume.isn-etl.command":"c001"}' | ConvertFrom-Json
Assert-True ((Get-DoctorEvidenceContainerLabel -Labels $dockerLabels -Name 'org.weylume.isn-etl.invocation') -eq '11111111111111111111111111111111') 'Docker inspect label extraction must preserve dotted Docker label keys.'
Assert-True ((Get-DoctorEvidenceContainerLabel -Labels $dockerLabels -Name 'org.weylume.isn-etl.command') -eq 'c001') 'Docker inspect label extraction must preserve the command correlation label.'
Assert-True ($null -eq (Get-DoctorEvidenceContainerLabel -Labels $dockerLabels -Name 'org.weylume.isn-etl.missing')) 'Missing Docker labels must remain missing rather than being fabricated.'
$mockContainerId = 'd' * 64
$mockInspectResponse = @([pscustomobject]@{
    Id = $mockContainerId
    Config = [pscustomobject]@{ Labels = $dockerLabels }
}) | ConvertTo-Json -Depth 8
$parsedInspect = ConvertFrom-DoctorContainerInspect -Json $mockInspectResponse -ExpectedContainerId $mockContainerId.Substring(0, 12) -ExpectedInvocationId '11111111111111111111111111111111' -ExpectedCommandId 'c001'
Assert-True ($parsedInspect.Id -eq $mockContainerId -and (Get-DoctorEvidenceContainerLabel -Labels $parsedInspect.Config.Labels -Name 'org.weylume.isn-etl.invocation') -eq '11111111111111111111111111111111') 'A real-shaped simulated docker inspect response must preserve container identity and dotted labels.'
$wrongInspectIdentityRejected = $false
try { ConvertFrom-DoctorContainerInspect -Json $mockInspectResponse -ExpectedContainerId ('e' * 12) -ExpectedInvocationId '11111111111111111111111111111111' -ExpectedCommandId 'c001' | Out-Null }
catch { $wrongInspectIdentityRejected = $true }
Assert-True $wrongInspectIdentityRejected 'Docker inspect output for a different container ID must be rejected.'
$malformedInspectRejected = $false
try { ConvertFrom-DoctorContainerInspect -Json '{' -ExpectedContainerId $mockContainerId -ExpectedInvocationId '11111111111111111111111111111111' -ExpectedCommandId 'c001' | Out-Null }
catch { $malformedInspectRejected = $true }
Assert-True $malformedInspectRejected 'Malformed docker inspect output must be rejected.'

$bundle = New-TestEvidenceBundle
try {
    $arguments = New-TestValidationArguments $bundle
    $valid = Test-DoctorEvidence @arguments
    Assert-True $valid.eligible "Compatible completed Doctor evidence should be reusable: $($valid.reasons -join '; ')"
    Assert-True ((Get-DoctorEvidenceImmediateDisposition -Validation $valid) -eq 'VALIDATED') 'Complete eligible evidence should validate immediately.'
    Assert-True ($valid.doctor_invocation_id -eq $bundle.evidence.invocation_id) 'Reuse should preserve the source invocation ID.'
    Assert-True ($valid.compatible_checks.Count -gt 0) 'Reuse should report its compatibility checks.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $commandRecord = [pscustomobject]@{
        arguments = @('doctor')
        exit_code = 0
        started_at = $bundle.evidence.command.started_at_utc
        finished_at = $bundle.evidence.command.finished_at_utc
        docker_container_command_id = 'c001'
        stdout = 'logs/001-doctor.stdout.txt'
        stderr = 'logs/001-doctor.stderr.txt'
    }
    $containerSnapshot = [pscustomobject]@{
        command_id = 'c001'
        container_id = 'd' * 64
        image_id = $bundle.evidence.image.id
        invocation_label = $bundle.evidence.invocation_id
        command_label = 'c001'
        status = 'running'
        cpus = 2
        memory_bytes = 4294967296
        pids_limit = 256
        network_mode = 'none'
        mounts = $bundle.evidence.container.mounts
    }
    $produced = New-DoctorEvidenceRecord -ArtifactRoot $bundle.root -InvocationId $bundle.evidence.invocation_id `
        -Repository 'D:\repo' -Branch $bundle.evidence.branch -Head $bundle.evidence.head `
        -Image $bundle.evidence.image -Docker $bundle.evidence.docker -Limits $bundle.evidence.limits `
        -RuntimeDependencies $bundle.evidence.runtime_dependencies -SourceFingerprints $bundle.source_fingerprints `
        -Command $commandRecord -Container $containerSnapshot -ContainerCleanup $bundle.evidence.container_cleanup
    $producedPath = Join-Path $bundle.root 'reports\produced-doctor-evidence.json'
    $produced | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $producedPath -Encoding UTF8
    $arguments = New-TestValidationArguments $bundle
    $arguments.EvidencePath = $producedPath
    $producerValidation = Test-DoctorEvidence @arguments
    Assert-True ($produced.schema_version -eq 1 -and $producerValidation.eligible) "Fresh producer output must satisfy the same reuse schema: $($producerValidation.reasons -join '; ')"
    Assert-True ($produced.command.exit_code -eq 0 -and $produced.result -eq 'PASS') 'Producer output must preserve the actual successful Doctor exit and result.'

    $failedCommand = $commandRecord.PSObject.Copy()
    $failedCommand.exit_code = 17
    $failedProduced = New-DoctorEvidenceRecord -ArtifactRoot $bundle.root -InvocationId $bundle.evidence.invocation_id `
        -Repository 'D:\repo' -Branch $bundle.evidence.branch -Head $bundle.evidence.head `
        -Image $bundle.evidence.image -Docker $bundle.evidence.docker -Limits $bundle.evidence.limits `
        -RuntimeDependencies $bundle.evidence.runtime_dependencies -SourceFingerprints $bundle.source_fingerprints `
        -Command $failedCommand -Container $containerSnapshot -ContainerCleanup $bundle.evidence.container_cleanup
    Assert-True ($failedProduced.command.exit_code -eq 17 -and $failedProduced.result -eq 'FAIL') 'Producer must not label a nonzero Doctor exit as PASS.'

    [System.IO.File]::WriteAllText((Join-Path $bundle.root 'logs\001-doctor.stdout.txt'), 'Doctor exited 0 without the required smoke marker.', [System.Text.UTF8Encoding]::new($false))
    $missingMarkerProduced = New-DoctorEvidenceRecord -ArtifactRoot $bundle.root -InvocationId $bundle.evidence.invocation_id `
        -Repository 'D:\repo' -Branch $bundle.evidence.branch -Head $bundle.evidence.head `
        -Image $bundle.evidence.image -Docker $bundle.evidence.docker -Limits $bundle.evidence.limits `
        -RuntimeDependencies $bundle.evidence.runtime_dependencies -SourceFingerprints $bundle.source_fingerprints `
        -Command $commandRecord -Container $containerSnapshot -ContainerCleanup $bundle.evidence.container_cleanup
    Assert-True ($missingMarkerProduced.command.exit_code -eq 0 -and $missingMarkerProduced.result -eq 'FAIL') 'Producer must require the actual Doctor PASS marker in completed stdout.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $missing = New-TestValidationArguments $bundle
    $missing.EvidencePath = Join-Path $bundle.root 'reports\missing.json'
    $result = Test-DoctorEvidence @missing
    Assert-True (-not $result.eligible -and $result.reasons.Count -gt 0) 'Missing evidence must be rejected with a reason.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    [System.IO.File]::WriteAllText($bundle.evidence_path, '{', [System.Text.UTF8Encoding]::new($false))
    $arguments = New-TestValidationArguments $bundle
    $malformed = Test-DoctorEvidence @arguments
    Assert-True (-not $malformed.eligible -and ($malformed.reasons -join ' ') -match 'JSON|parse') 'Malformed evidence must be rejected.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $bundle.evidence.source_fingerprints = @()
    $bundle.evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $bundle.evidence_path -Encoding UTF8
    $arguments = New-TestValidationArguments $bundle
    $incomplete = Test-DoctorEvidence @arguments
    Assert-True (-not $incomplete.eligible -and ($incomplete.reasons -join ' ') -match 'fingerprint') 'Incomplete evidence must be rejected with the missing fact identified.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $bundle.evidence.schema_version = 'not-a-version'
    $bundle.evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $bundle.evidence_path -Encoding UTF8
    $arguments = New-TestValidationArguments $bundle
    $malformedContract = Test-DoctorEvidence @arguments
    Assert-True (-not $malformedContract.eligible -and ($malformedContract.reasons -join ' ') -match 'schema_version') 'Malformed evidence schema metadata must be rejected with a reason.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $bundle.evidence.result = 'FAIL'
    $bundle.evidence.command.exit_code = 1
    $bundle.evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $bundle.evidence_path -Encoding UTF8
    $arguments = New-TestValidationArguments $bundle
    $failed = Test-DoctorEvidence @arguments
    Assert-True (-not $failed.eligible) 'Failed Doctor evidence must be rejected.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $stdoutPath = Join-Path $bundle.root 'logs\001-doctor.stdout.txt'
    [System.IO.File]::WriteAllText($stdoutPath, 'Doctor output was truncated before completion', [System.Text.UTF8Encoding]::new($false))
    $arguments = New-TestValidationArguments $bundle
    $inconclusive = Test-DoctorEvidence @arguments
    Assert-True (-not $inconclusive.eligible -and ($inconclusive.reasons -join ' ') -match 'SHA-256|marker|Doctor stdout|hash') 'Inconclusive or tampered Doctor output must be rejected.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $arguments = New-TestValidationArguments $bundle
    $arguments.CurrentImage = [pscustomobject]@{ reference = $arguments.ExpectedImage; id = 'sha256:' + ('e' * 64); os = 'linux'; architecture = 'amd64'; user = '10001:10001' }
    $mismatch = Test-DoctorEvidence @arguments
    Assert-True (-not $mismatch.eligible -and ($mismatch.reasons -join ' ') -match 'image') 'Image digest mismatch must be rejected.'
    Assert-True ((Get-DoctorEvidenceImmediateDisposition -Validation $mismatch) -eq 'REJECTED') 'An evidence compatibility defect must reject immediately rather than wait for memory recovery.'
    $failedOutcome = New-DoctorOutcome -Mode 'EXECUTED' -Validation $mismatch -EvidencePath $bundle.evidence_path
    Assert-True ($failedOutcome.result -eq 'PASS' -and $failedOutcome.etl_00_status -eq 'FAIL_FRESH_DOCKER_EVIDENCE_VALIDATION') 'A successful Doctor smoke with incompatible evidence must not report ETL-00 PASS.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $bundle.evidence.limits.memory_bytes = 2147483648
    $bundle.evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $bundle.evidence_path -Encoding UTF8
    $arguments = New-TestValidationArguments $bundle
    $mismatch = Test-DoctorEvidence @arguments
    Assert-True (-not $mismatch.eligible -and ($mismatch.reasons -join ' ') -match 'limit') 'Unapproved resource limits must be rejected.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $bundle.evidence.container.labels.invocation_id = '99999999999999999999999999999999'
    $bundle.evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $bundle.evidence_path -Encoding UTF8
    $arguments = New-TestValidationArguments $bundle
    $mismatch = Test-DoctorEvidence @arguments
    Assert-True (-not $mismatch.eligible -and ($mismatch.reasons -join ' ') -match 'label|invocation') 'Container labels must bind the Doctor container to the evidence invocation and command.'
} finally { Remove-TestBundle $bundle.root }

foreach ($emptyInvocationLabel in @('', $null)) {
    $bundle = New-TestEvidenceBundle
    try {
        $bundle.evidence.container.labels.invocation_id = $emptyInvocationLabel
        $bundle.evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $bundle.evidence_path -Encoding UTF8
        $arguments = New-TestValidationArguments $bundle
        $missingLabel = Test-DoctorEvidence @arguments
        Assert-True (-not $missingLabel.eligible -and ($missingLabel.reasons -join ' ') -match 'label|invocation') 'Missing or empty Docker invocation labels must be rejected.'
    } finally { Remove-TestBundle $bundle.root }
}

$bundle = New-TestEvidenceBundle
try {
    $bundle.evidence.container.labels = [pscustomobject]@{ command_id = 'c001' }
    $bundle.evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $bundle.evidence_path -Encoding UTF8
    $arguments = New-TestValidationArguments $bundle
    $missingLabel = Test-DoctorEvidence @arguments
    Assert-True (-not $missingLabel.eligible -and ($missingLabel.reasons -join ' ') -match 'label|invocation') 'An absent Docker invocation label must be rejected.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $bundle.evidence.command.container_id = 'e' * 64
    $bundle.evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $bundle.evidence_path -Encoding UTF8
    $arguments = New-TestValidationArguments $bundle
    $identityMismatch = Test-DoctorEvidence @arguments
    Assert-True (-not $identityMismatch.eligible -and ($identityMismatch.reasons -join ' ') -match 'correlation|container') 'A command/container ID mismatch must be rejected.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $bundle.evidence.container_cleanup.cidfile_id = 'e' * 64
    $bundle.evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $bundle.evidence_path -Encoding UTF8
    $arguments = New-TestValidationArguments $bundle
    $teardownMismatch = Test-DoctorEvidence @arguments
    Assert-True (-not $teardownMismatch.eligible -and ($teardownMismatch.reasons -join ' ') -match 'cidfile|removal') 'A cidfile/container teardown identity mismatch must be rejected.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $arguments = New-TestValidationArguments $bundle
    $arguments.CurrentRuntimeDependencies = [pscustomobject]@{ python = '3.12.15'; pyspark = '3.5.8'; py4j = '0.10.9.7'; java = '17.0.20.1'; spark = '3.5.9'; master = 'local[2]' }
    $mismatch = Test-DoctorEvidence @arguments
    Assert-True (-not $mismatch.eligible -and ($mismatch.reasons -join ' ') -match 'dependency') 'Required runtime dependency mismatch must be rejected.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $arguments = New-TestValidationArguments $bundle
    $arguments.CurrentSourceFingerprints = @([pscustomobject]@{ path = 'scripts/data-pipeline.ps1'; sha256 = 'e' * 64 })
    $mismatch = Test-DoctorEvidence @arguments
    Assert-True (-not $mismatch.eligible -and ($mismatch.reasons -join ' ') -match 'source/configuration fingerprints') 'Runtime source changes must invalidate reuse.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $arguments = New-TestValidationArguments $bundle
    $arguments.CurrentDocker.powershell_executable_sha256 = '8' * 64
    $mismatch = Test-DoctorEvidence @arguments
    Assert-True (-not $mismatch.eligible -and ($mismatch.reasons -join ' ') -match 'powershell_executable_sha256') 'PowerShell executable changes must invalidate reuse.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $arguments = New-TestValidationArguments $bundle
    $arguments.CurrentDocker = [pscustomobject]@{ context_name = 'other-context'; configuration_sha256 = 'f' * 64; daemon_id = 'other-daemon'; server_version = '29.8.2'; client_version = '29.8.2'; docker_cli_sha256 = 'e' * 64; powershell_version = '5.1.19041.5247'; powershell_executable_sha256 = '9' * 64; launcher_powershell_executable_sha256 = '8' * 64; cpus = 24; memory_bytes = 8176463872; os = 'linux'; architecture = 'x86_64' }
    $mismatch = Test-DoctorEvidence @arguments
    Assert-True (-not $mismatch.eligible -and ($mismatch.reasons -join ' ') -match 'context|configuration|daemon') 'Docker context/configuration mismatch must be rejected.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $arguments = New-TestValidationArguments $bundle
    $arguments.ConflictingProcesses = @('java.exe:9876')
    $blocked = Test-DoctorEvidence @arguments
    Assert-True (-not $blocked.eligible -and ($blocked.reasons -join ' ') -match 'process') 'Conflicting Spark/acceptance processes must block reuse.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $arguments = New-TestValidationArguments $bundle
    $arguments.RunningContainers = @('spark-in-use')
    $blocked = Test-DoctorEvidence @arguments
    Assert-True (-not $blocked.eligible -and ($blocked.reasons -join ' ') -match 'container|workload') 'Conflicting containers must block reuse.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $arguments = New-TestValidationArguments $bundle
    $arguments.CurrentAllContainerIds = @($bundle.evidence.container.container_id)
    $blocked = Test-DoctorEvidence @arguments
    Assert-True (-not $blocked.eligible -and ($blocked.reasons -join ' ') -match 'container.*still present') 'Doctor container still present in Docker inventory must block reuse.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $arguments = New-TestValidationArguments $bundle
    $arguments.CurrentHostFreeBytes = [long]4000000000
    $blocked = Test-DoctorEvidence @arguments
    Assert-True (-not $blocked.eligible -and ($blocked.reasons -join ' ') -match 'RAM|headroom|memory') 'Low current RAM must block reuse.'
    Assert-True ((Get-DoctorEvidenceImmediateDisposition -Validation $blocked) -eq 'COMPATIBLE_AWAITING_RAM_GATE') 'A RAM-only blocker should preserve evidence compatibility while withholding reuse eligibility.'
    $decision = Resolve-DoctorExecution -EvidencePath $bundle.evidence_path -Validation $blocked
    Assert-True ($decision.mode -eq 'REJECTED' -and -not $decision.allow_spark -and -not $decision.execute_doctor) 'Valid evidence must not bypass a failing live RAM gate or trigger a Doctor fallback.'
    $blockedOutcome = New-DoctorOutcome -Mode 'EXECUTED' -Validation $blocked -EvidencePath $bundle.evidence_path
    Assert-True ($blockedOutcome.etl_00_status -eq 'BLOCKED_POST_DOCTOR_HOST_RAM') 'A passing Doctor smoke without the live RAM gate must not mark ETL-00 PASS.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $arguments = New-TestValidationArguments $bundle
    $validation = Test-DoctorEvidence @arguments
    $legacy = Resolve-DoctorExecution -EvidencePath $bundle.evidence_path -Validation $validation
    Assert-True ($legacy.mode -eq 'REUSED' -and -not $legacy.execute_doctor -and $legacy.allow_spark) 'Valid evidence should select reuse without running Doctor.'
    $arguments.CurrentImage.id = 'sha256:' + ('e' * 64)
    $validation = Test-DoctorEvidence @arguments
    $invalid = Resolve-DoctorExecution -EvidencePath $bundle.evidence_path -Validation $validation
    Assert-True ($invalid.mode -eq 'REJECTED' -and -not $invalid.execute_doctor -and -not $invalid.allow_spark) 'Invalid opt-in reuse must neither fall back to Doctor nor permit Spark.'
    $default = Resolve-DoctorExecution -EvidencePath '' -Validation $validation
    Assert-True ($default.mode -eq 'EXECUTE' -and $default.execute_doctor -and -not $default.allow_spark) 'Default mode must require a fresh Doctor and remain Spark-blocked until it completes.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $arguments = New-TestValidationArguments $bundle
    $validation = Test-DoctorEvidence @arguments
    $outcome = New-DoctorOutcome -Mode 'REUSED' -Validation $validation -EvidencePath $bundle.evidence_path
    Assert-True ($outcome.status -eq 'REUSED' -and $outcome.etl_00_status -eq 'PASS_REUSED_DOCKER_DOCTOR') 'ETL-00 must distinguish reused Doctor evidence from fresh execution.'
    Assert-True ($outcome.original_evidence_path -eq $bundle.evidence_path -and -not $outcome.doctor_invocation_executed) 'Reuse reporting must preserve original evidence provenance.'
    $pending = [pscustomobject]@{ eligible = $false; validation_status = 'NOT_RUN_IMMEDIATE_POST_DOCTOR_VALIDATION'; doctor_invocation_id = $bundle.evidence.invocation_id; compatible_checks = @(); reasons = @('Immediate strict validation not run.') }
    $pendingOutcome = New-DoctorOutcome -Mode 'EXECUTED' -Validation $pending -EvidencePath $bundle.evidence_path
    Assert-True ($pendingOutcome.evidence_validation_status -eq 'NOT_RUN_IMMEDIATE_POST_DOCTOR_VALIDATION' -and $pendingOutcome.result -eq 'PASS' -and $pendingOutcome.etl_00_status -eq 'PENDING_STRICT_DOCKER_EVIDENCE_VALIDATION') 'A successful Doctor run must not be reported as ETL-00 PASS before immediate strict evidence validation.'
} finally { Remove-TestBundle $bundle.root }

$bundle = New-TestEvidenceBundle
try {
    $legacy = [pscustomobject]@{
        invocation_id = '33333333333333333333333333333333'
        root = $bundle.root
        status = 'BLOCKED_POST_DOCTOR_HOST_RAM'
        commands = @([pscustomobject]@{ name = 'doctor'; exit_code = 0; docker_container_command_id = 'c001'; stdout = 'logs/001-doctor.stdout.txt'; stderr = 'logs/001-doctor.stderr.txt'; arguments = @('-File', 'scripts/data-pipeline.ps1', 'doctor'); started_at = '2026-10-14T19:25:56Z'; finished_at = '2026-10-14T19:26:08Z' })
        containers = @([pscustomobject]@{ command_id = 'c001'; container_id = 'd' * 64; image_id = $bundle.evidence.image.id; status = 'running'; cpus = 2; memory_bytes = 4294967296; pids_limit = 256; network_mode = 'none' })
        runtime_preflight = [pscustomobject]@{ image = $bundle.evidence.image.reference; image_inspect = "$($bundle.evidence.image.id)|linux|amd64|10001:10001"; docker_cpus = 24; docker_memory_bytes = 8176463872; docker_os = 'linux'; docker_architecture = 'x86_64' }
    }
    $legacyPath = Join-Path $bundle.root 'reports\legacy-failure.json'
    $legacy | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $legacyPath -Encoding UTF8
    $arguments = New-TestValidationArguments $bundle
    $arguments.EvidencePath = $legacyPath
    $result = Test-DoctorEvidence @arguments
    Assert-True (-not $result.eligible) 'Historical reports missing compatibility fields must fail closed.'
    Assert-True (($result.reasons -join ' ') -match 'context|daemon|fingerprint|hash') 'Rejection must identify missing historical context/source/log integrity facts.'
} finally { Remove-TestBundle $bundle.root }

Write-Output "ACCEPTANCE_DOCTOR_EVIDENCE_TESTS=PASS ($script:assertions assertions)"
