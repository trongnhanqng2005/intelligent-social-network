function Resolve-DockerStatsResult {
    param(
        [Parameter(Mandatory = $true)][int]$ExitCode,
        [AllowEmptyString()][string]$CombinedOutput,
        [Parameter(Mandatory = $true)][string]$ContainerStateAfterFailure
    )
    $output = if ($null -eq $CombinedOutput) { '' } else { $CombinedOutput.Trim() }
    if ($ExitCode -eq 0 -and $output -match '^(?<memory>[^|\r\n]+)\|(?<pids>\d+)$') {
        return [pscustomobject]@{ status = 'PASS'; exit_code = 0; combined_output = $output; memory_usage = $Matches.memory; pids_current = [int]$Matches.pids; container_state_after_failure = $ContainerStateAfterFailure; reason = $null }
    }
    $containerIsGone = $ContainerStateAfterFailure -in @('missing', 'exited', 'dead', 'removing')
    $knownTeardownError = $output -match '(?i)(\bEOF\b|no such (object|container)|\bnot found\b|\bnot running\b|container.{0,40}(exited|dead|removing|removed)|(exited|dead|removing|removed).{0,40}container)'
    if ($containerIsGone -and (($ExitCode -ne 0 -and $knownTeardownError) -or ($ExitCode -eq 0 -and -not $output))) {
        return [pscustomobject]@{ status = 'BENIGN_TEARDOWN_RACE'; exit_code = $ExitCode; combined_output = $output; memory_usage = $null; pids_current = $null; container_state_after_failure = $ContainerStateAfterFailure; reason = 'Container disappearance/exit was confirmed after the stats sample ended.' }
    }
    $reason = if ($ExitCode -ne 0) { "docker stats exited $ExitCode while container state was $ContainerStateAfterFailure." } else { "docker stats returned an invalid or empty sample while container state was $ContainerStateAfterFailure." }
    return [pscustomobject]@{ status = 'FAILED'; exit_code = $ExitCode; combined_output = $output; memory_usage = $null; pids_current = $null; container_state_after_failure = $ContainerStateAfterFailure; reason = $reason }
}

function Get-DockerMonitoringDisposition {
    param([AllowNull()][object]$ChildExitCode, [object[]]$MonitoringEvents = @())
    $failures = @($MonitoringEvents | Where-Object { $_.status -eq 'FAILED' })
    $races = @($MonitoringEvents | Where-Object { $_.status -eq 'BENIGN_TEARDOWN_RACE' })
    $exitCode = 0
    if ($null -eq $ChildExitCode -or $ChildExitCode -is [bool] -or -not [int]::TryParse([string]$ChildExitCode, [ref]$exitCode)) {
        return [pscustomobject]@{ status = 'UNKNOWN_CHILD_RESULT'; blocks_success = $true; preserves_child_failure = $false; failure_count = $failures.Count; teardown_race_count = $races.Count }
    }
    if ($failures.Count -gt 0 -and $exitCode -eq 0) {
        return [pscustomobject]@{ status = 'FAIL'; blocks_success = $true; preserves_child_failure = $false; failure_count = $failures.Count; teardown_race_count = $races.Count }
    }
    if ($failures.Count -gt 0) {
        return [pscustomobject]@{ status = 'CHILD_FAILED_MONITORING_ALSO_FAILED'; blocks_success = $false; preserves_child_failure = $true; failure_count = $failures.Count; teardown_race_count = $races.Count }
    }
    if ($exitCode -ne 0) {
        return [pscustomobject]@{ status = 'CHILD_FAILED'; blocks_success = $false; preserves_child_failure = $true; failure_count = 0; teardown_race_count = $races.Count }
    }
    if ($races.Count -gt 0) {
        return [pscustomobject]@{ status = 'PASS_WITH_BENIGN_TEARDOWN_RACE'; blocks_success = $false; preserves_child_failure = $false; failure_count = 0; teardown_race_count = $races.Count }
    }
    return [pscustomobject]@{ status = 'PASS'; blocks_success = $false; preserves_child_failure = $false; failure_count = 0; teardown_race_count = 0 }
}

function Test-AcceptanceMonitoringClean {
    param([object[]]$MonitoringEvents = @())
    return (@($MonitoringEvents | Where-Object { $_.status -eq 'FAILED' }).Count -eq 0)
}

function Invoke-DockerMonitoringAction {
    param([Parameter(Mandatory = $true)][scriptblock]$Action)
    try {
        $value = & $Action
        return [pscustomobject]@{ status = 'PASS'; value = $value; error = $null }
    } catch {
        return [pscustomobject]@{ status = 'FAILED'; value = $null; error = $_.Exception.Message }
    }
}

function Test-DockerUnavailableResult {
    param(
        [AllowNull()][object]$ExitCode,
        [AllowNull()][AllowEmptyString()][string]$CombinedOutput,
        [string]$ExpectedEndpointMarker = 'isn-etl-acceptance-unavailable'
    )
    $exitCodeValue = 0
    if ($null -eq $ExitCode -or $ExitCode -is [bool] -or -not [int]::TryParse([string]$ExitCode, [ref]$exitCodeValue) -or $exitCodeValue -ne 2) {
        return $false
    }
    $text = if ($null -eq $CombinedOutput) { '' } else { $CombinedOutput }
    if ($text -match '(?i)\bDocker daemon is unavailable\b') { return $true }
    $hasExpectedEndpoint = $text.IndexOf($ExpectedEndpointMarker, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    $isDockerConnectionFailure = $text -match '(?i)(failed|unable|cannot|could not) to connect to (the )?docker (api|daemon)|error during connect'
    $isUnavailableTransport = $text -match '(?i)(no such file|not found|system cannot find|connection refused|actively refused|pipe.{0,30}(closed|ended|not found))'
    return ($hasExpectedEndpoint -and $isDockerConnectionFailure -and $isUnavailableTransport)
}

function Resolve-IndependentVerifierResult {
    param(
        [AllowNull()][object]$ExitCode,
        [AllowNull()][AllowEmptyString()][string]$StandardOutput
    )
    $report = $null
    $parseError = $null
    if (-not [string]::IsNullOrWhiteSpace($StandardOutput)) {
        try { $report = ConvertFrom-Json -InputObject $StandardOutput -ErrorAction Stop }
        catch { $parseError = $_.Exception.Message }
    }

    $exitCodeValue = 0
    if ($null -eq $ExitCode -or $ExitCode -is [bool] -or -not [int]::TryParse([string]$ExitCode, [ref]$exitCodeValue)) {
        return [pscustomobject]@{ status = 'RESULT_NOT_CAPTURED'; report = $report; reason = 'Verifier process exit code is missing or invalid.' }
    }
    if ($exitCodeValue -ne 0) {
        return [pscustomobject]@{ status = 'VERIFIER_FAILED'; report = $report; reason = "Verifier process exited $exitCodeValue." }
    }
    if ([string]::IsNullOrWhiteSpace($StandardOutput)) {
        return [pscustomobject]@{ status = 'RESULT_NOT_CAPTURED'; report = $null; reason = 'Verifier stdout is empty.' }
    }
    if ($parseError) {
        return [pscustomobject]@{ status = 'VERIFIER_FAILED'; report = $null; reason = "Verifier stdout is not valid JSON: $parseError" }
    }
    if ($null -eq $report -or $report.status -ne 'PASS' -or @($report.cases).Count -eq 0) {
        return [pscustomobject]@{ status = 'VERIFIER_FAILED'; report = $report; reason = 'Verifier report lacks status PASS or completed case results.' }
    }
    if ($null -eq $report.resources -or $report.resources.spark_context_stopped -ne $true -or $report.resources.active_spark_session_after_stop -ne $false) {
        return [pscustomobject]@{ status = 'VERIFIER_FAILED'; report = $report; reason = 'Verifier report lacks successful Spark context/session teardown evidence.' }
    }
    return [pscustomobject]@{ status = 'PASS'; report = $report; reason = $null }
}
