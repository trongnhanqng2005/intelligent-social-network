function Test-IsConflictingAcceptanceProcess {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()][string]$CommandLine
    )
    if ($Name -notmatch '^(powershell|pwsh|python|python3|java|node|npm|npx)(\.exe)?$') { return $false }
    return ([string]$CommandLine -match '(?i)(acceptance\.ps1|acceptance_verify\.py|test_acceptance\.py|org\.apache\.spark|pyspark|isn_etl|isn-c|posts.{0,20}feed|feed.{0,20}posts|playwright.*(test|e2e)|npm.*(test|e2e)|node.*(test|e2e)|jest|vitest)')
}

function Get-AvailableHostMemoryBytes {
    $osInfo = Get-CimInstance Win32_OperatingSystem
    return [long]$osInfo.FreePhysicalMemory * 1KB
}

function Wait-ForHostMemoryHeadroom {
    param(
        [Parameter(Mandatory = $true)][string]$Phase,
        [Parameter(Mandatory = $true)][long]$MinimumBytes,
        [Parameter(Mandatory = $true)][scriptblock]$ReadAvailableBytes,
        [ValidateRange(0, 4)][int]$RecoveryAttempts = 4,
        [ValidateRange(0, 15)][int]$RecoveryIntervalSeconds = 15
    )

    $samples = [System.Collections.Generic.List[object]]::new()
    for ($attempt = 0; $attempt -le $RecoveryAttempts; $attempt++) {
        if ($attempt -gt 0 -and $RecoveryIntervalSeconds -gt 0) {
            Start-Sleep -Seconds $RecoveryIntervalSeconds
        }
        $availableBytes = [long](& $ReadAvailableBytes)
        $samples.Add([pscustomobject]@{
            phase = $Phase
            sample_number = $attempt + 1
            captured_at_utc = [DateTime]::UtcNow.ToString('o')
            available_bytes = $availableBytes
            available_gib = [math]::Round($availableBytes / 1GB, 3)
        })
        if ($availableBytes -ge $MinimumBytes) {
            return [pscustomobject]@{
                passed = $true
                minimum_bytes = $MinimumBytes
                recovery_attempts = $attempt
                waited_seconds = $attempt * $RecoveryIntervalSeconds
                samples = @($samples.ToArray())
            }
        }
    }

    return [pscustomobject]@{
        passed = $false
        minimum_bytes = $MinimumBytes
        recovery_attempts = $RecoveryAttempts
        waited_seconds = $RecoveryAttempts * $RecoveryIntervalSeconds
        samples = @($samples.ToArray())
    }
}
