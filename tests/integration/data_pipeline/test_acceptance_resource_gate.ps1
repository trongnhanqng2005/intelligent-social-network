$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'acceptance_resource_gate.ps1')

function New-SequenceReader {
    param([long[]]$Values)
    $queue = [System.Collections.Generic.Queue[long]]::new()
    foreach ($value in $Values) { $queue.Enqueue($value) }
    return { [long]$queue.Dequeue() }.GetNewClosure()
}

function Assert-Equal {
    param([object]$Actual, [object]$Expected, [string]$Message)
    if ($Actual -ne $Expected) { throw "$Message; expected=$Expected actual=$Actual" }
}

$minimumBytes = [long]100
$initialPass = Wait-ForHostMemoryHeadroom -Phase 'initial-pass' -MinimumBytes $minimumBytes -ReadAvailableBytes (New-SequenceReader -Values @([long]110)) -RecoveryAttempts 4 -RecoveryIntervalSeconds 0
Assert-Equal -Actual $initialPass.passed -Expected $true -Message 'Initial headroom should pass immediately'
Assert-Equal -Actual $initialPass.samples.Count -Expected 1 -Message 'Initial pass should take one sample'

$recovery = Wait-ForHostMemoryHeadroom -Phase 'post-doctor' -MinimumBytes $minimumBytes -ReadAvailableBytes (New-SequenceReader -Values @([long]90, [long]105)) -RecoveryAttempts 4 -RecoveryIntervalSeconds 0
Assert-Equal -Actual $recovery.passed -Expected $true -Message 'Recovered headroom should pass'
Assert-Equal -Actual $recovery.samples.Count -Expected 2 -Message 'Recovery should stop at the first passing sample'
Assert-Equal -Actual $recovery.samples[0].available_bytes -Expected ([long]90) -Message 'The below-gate sample should be retained'
Assert-Equal -Actual $recovery.samples[1].available_bytes -Expected ([long]105) -Message 'The recovered sample should be retained'

$blocked = Wait-ForHostMemoryHeadroom -Phase 'post-doctor' -MinimumBytes $minimumBytes -ReadAvailableBytes (New-SequenceReader -Values @([long]80, [long]81, [long]82, [long]130)) -RecoveryAttempts 2 -RecoveryIntervalSeconds 0
Assert-Equal -Actual $blocked.passed -Expected $false -Message 'Persistently low headroom should remain blocked'
Assert-Equal -Actual $blocked.samples.Count -Expected 3 -Message 'Recovery attempts should be strictly bounded'

if (-not (Test-IsConflictingAcceptanceProcess -Name 'java.exe' -CommandLine 'java org.apache.spark.deploy.SparkSubmit')) { throw 'An active Spark process must block acceptance.' }
if (-not (Test-IsConflictingAcceptanceProcess -Name 'powershell.exe' -CommandLine 'powershell -File C:\ISN-C\posts-feed\verify.ps1')) { throw 'ISN-C Posts & Feed verification must block acceptance.' }
if (Test-IsConflictingAcceptanceProcess -Name 'java.exe' -CommandLine 'java com.neo4j.server.enterprise.Neo4jEnterprise console') { throw 'Unrelated Neo4j service processes must not be classified as ISN-B Spark acceptance conflicts.' }
if (Test-IsConflictingAcceptanceProcess -Name 'powershell.exe' -CommandLine 'powershell -File C:\tools\backup.ps1') { throw 'Unrelated PowerShell processes must not block acceptance.' }

Write-Output 'ACCEPTANCE_RESOURCE_GATE_TESTS=PASS (3 memory cases; 4 process-classifier cases)'
