$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'acceptance_docker_monitoring.ps1')
$assertions = 0

function Assert-True {
    param([bool]$Value, [string]$Message)
    $script:assertions++
    if (-not $Value) { throw $Message }
}

$valid = Resolve-DockerStatsResult -ExitCode 0 -CombinedOutput '543.6MiB / 4GiB|90' -ContainerStateAfterFailure 'running'
Assert-True ($valid.status -eq 'PASS' -and $valid.memory_usage -eq '543.6MiB / 4GiB' -and $valid.pids_current -eq 90) 'Valid Docker stats should be parsed.'

$race = Resolve-DockerStatsResult -ExitCode 1 -CombinedOutput 'Error response from daemon: EOF' -ContainerStateAfterFailure 'missing'
Assert-True ($race.status -eq 'BENIGN_TEARDOWN_RACE' -and $race.combined_output -match 'EOF' -and $null -eq $race.memory_usage) 'Confirmed teardown races must retain EOF and must not fabricate a sample.'

$removedContainer = Resolve-DockerStatsResult -ExitCode 1 -CombinedOutput 'Error response from daemon: no such container' -ContainerStateAfterFailure 'missing'
Assert-True ($removedContainer.status -eq 'BENIGN_TEARDOWN_RACE') 'A confirmed no-such-container response after removal must be classified as a teardown race.'
$removedObject = Resolve-DockerStatsResult -ExitCode 1 -CombinedOutput 'Error: No such object: deadbeef' -ContainerStateAfterFailure 'missing'
Assert-True ($removedObject.status -eq 'BENIGN_TEARDOWN_RACE') 'Docker inspect no-such-object after --rm must be classified as a confirmed teardown race.'

$unrelatedMonitoringFailure = Resolve-DockerStatsResult -ExitCode 1 -CombinedOutput 'permission denied while reading container stats' -ContainerStateAfterFailure 'missing'
Assert-True ($unrelatedMonitoringFailure.status -eq 'FAILED') 'Container disappearance must not hide an unrelated Docker monitoring failure.'

$runningFailure = Resolve-DockerStatsResult -ExitCode 1 -CombinedOutput 'Error response from daemon: EOF' -ContainerStateAfterFailure 'running'
Assert-True ($runningFailure.status -eq 'FAILED' -and $runningFailure.reason -match 'exited 1' -and $runningFailure.combined_output -match 'EOF') 'EOF while the container remains active must fail monitoring with its reason.'

$nullSample = Resolve-DockerStatsResult -ExitCode 0 -CombinedOutput '' -ContainerStateAfterFailure 'running'
Assert-True ($nullSample.status -eq 'FAILED' -and $null -eq $nullSample.memory_usage) 'A null stats sample must never be treated as PASS.'

$malformed = Resolve-DockerStatsResult -ExitCode 0 -CombinedOutput 'not memory telemetry' -ContainerStateAfterFailure 'running'
Assert-True ($malformed.status -eq 'FAILED' -and $malformed.reason -match 'invalid or empty') 'Malformed successful output must fail monitoring.'

$monitoringFailure = Get-DockerMonitoringDisposition -ChildExitCode 0 -MonitoringEvents @([pscustomobject]@{ status = 'FAILED' })
Assert-True ($monitoringFailure.status -eq 'FAIL' -and $monitoringFailure.blocks_success) 'Monitoring failure must prevent an otherwise successful child from passing.'

$sparkFailure = Get-DockerMonitoringDisposition -ChildExitCode 17 -MonitoringEvents @([pscustomobject]@{ status = 'FAILED' })
Assert-True ($sparkFailure.preserves_child_failure -and -not $sparkFailure.blocks_success) 'Monitoring diagnostics must not replace the actual Spark/container exit failure.'

$raceDisposition = Get-DockerMonitoringDisposition -ChildExitCode 0 -MonitoringEvents @([pscustomobject]@{ status = 'BENIGN_TEARDOWN_RACE' })
Assert-True ($raceDisposition.status -eq 'PASS_WITH_BENIGN_TEARDOWN_RACE' -and $raceDisposition.teardown_race_count -eq 1) 'A confirmed teardown race must remain visible in the final disposition.'

$unknownExitDisposition = Get-DockerMonitoringDisposition -ChildExitCode $null -MonitoringEvents @()
Assert-True ($unknownExitDisposition.status -eq 'UNKNOWN_CHILD_RESULT' -and $unknownExitDisposition.blocks_success) 'A missing child exit code must never be interpreted as PASS.'

$stopPreference = $ErrorActionPreference
$ErrorActionPreference = 'Stop'
$monitorSuccess = Invoke-DockerMonitoringAction { 'monitor sample retained' }
$monitorException = Invoke-DockerMonitoringAction { throw 'docker inspect: no such object after --rm' }
$ErrorActionPreference = $stopPreference
Assert-True ($monitorSuccess.status -eq 'PASS' -and $monitorSuccess.value -eq 'monitor sample retained') 'A completed monitoring action must preserve its returned sample.'
Assert-True ($monitorException.status -eq 'FAILED' -and $monitorException.error -match 'no such object') 'A terminating monitoring exception must be captured as a monitoring result, not escape before child evidence is saved.'

$endpointDiagnostic = 'data-pipeline doctor failed: failed to connect to the docker API at npipe:////./pipe/isn-etl-acceptance-unavailable; open //./pipe/isn-etl-acceptance-unavailable: The system cannot find the file specified.'
Assert-True (Test-DockerUnavailableResult -ExitCode 2 -CombinedOutput $endpointDiagnostic) 'A Docker connection failure for the intentionally unavailable endpoint and documented exit code should pass the CLI negative assertion.'
Assert-True (Test-DockerUnavailableResult -ExitCode 2 -CombinedOutput 'data-pipeline doctor failed: Docker daemon is unavailable for this child process.') 'The CLI-owned stable unavailable diagnostic should be accepted without requiring Docker-version-specific wording.'
Assert-True (-not (Test-DockerUnavailableResult -ExitCode 0 -CombinedOutput $endpointDiagnostic)) 'The Docker-unavailable assertion must reject the wrong process exit code.'
Assert-True (-not (Test-DockerUnavailableResult -ExitCode 2 -CombinedOutput 'data-pipeline doctor failed: access denied reading configuration')) 'The Docker-unavailable assertion must reject unrelated command failures.'
Assert-True (-not (Test-DockerUnavailableResult -ExitCode 2 -CombinedOutput 'failed to connect to the docker API at tcp://other-host:2375: connection refused')) 'The Docker-unavailable assertion must reject failures for an unrelated endpoint.'

$passVerifier = Resolve-IndependentVerifierResult -ExitCode 0 -StandardOutput '{"status":"PASS","cases":[{}],"resources":{"spark_context_stopped":true,"active_spark_session_after_stop":false}}'
Assert-True ($passVerifier.status -eq 'PASS' -and $passVerifier.report.status -eq 'PASS') 'A captured zero exit and valid PASS report should be recognized.'
$missingVerifierOutput = Resolve-IndependentVerifierResult -ExitCode 0 -StandardOutput ''
Assert-True ($missingVerifierOutput.status -eq 'RESULT_NOT_CAPTURED') 'A missing verifier report must never be reported as PASS.'
$unknownVerifierExit = Resolve-IndependentVerifierResult -ExitCode $null -StandardOutput '{"status":"PASS","cases":[{}],"resources":{"spark_context_stopped":true,"active_spark_session_after_stop":false}}'
Assert-True ($unknownVerifierExit.status -eq 'RESULT_NOT_CAPTURED') 'A PASS-looking report with an unknown process exit code must never be reported as PASS.'
$failedVerifier = Resolve-IndependentVerifierResult -ExitCode 1 -StandardOutput '{"status":"PASS","cases":[{}],"resources":{"spark_context_stopped":true,"active_spark_session_after_stop":false}}'
Assert-True ($failedVerifier.status -eq 'VERIFIER_FAILED') 'A nonzero verifier process exit must not be overridden by PASS-looking stdout.'
$emptyCaseVerifier = Resolve-IndependentVerifierResult -ExitCode 0 -StandardOutput '{"status":"PASS","cases":[]}'
Assert-True ($emptyCaseVerifier.status -eq 'VERIFIER_FAILED') 'A PASS-looking report with no verified cases must not be accepted.'
$missingTeardownVerifier = Resolve-IndependentVerifierResult -ExitCode 0 -StandardOutput '{"status":"PASS","cases":[{}],"resources":{"spark_context_stopped":false,"active_spark_session_after_stop":true}}'
Assert-True ($missingTeardownVerifier.status -eq 'VERIFIER_FAILED') 'A PASS-looking report without successful Spark teardown evidence must not be accepted.'
$invalidVerifier = Resolve-IndependentVerifierResult -ExitCode 0 -StandardOutput 'not JSON'
Assert-True ($invalidVerifier.status -eq 'VERIFIER_FAILED') 'Malformed verifier output must be reported as failure, not PASS.'

Assert-True (Test-AcceptanceMonitoringClean -MonitoringEvents @()) 'No monitoring failures should permit completion.'
Assert-True (-not (Test-AcceptanceMonitoringClean -MonitoringEvents @([pscustomobject]@{ status = 'FAILED' }))) 'A monitoring failure during an expected-negative command must still block overall acceptance PASS.'

Write-Output "ACCEPTANCE_DOCKER_MONITORING_TESTS=PASS ($assertions assertions)"
