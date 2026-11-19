function Get-ProtectedInventoryRecords {
    param([Parameter(Mandatory = $true)][object]$Inventory)
    if ($Inventory.baseline_kind -ne 'fresh-preservation-snapshot') {
        throw 'Protected inventory must be explicitly identified as a fresh-preservation-snapshot.'
    }
    $records = @($Inventory.historical_publications) + @($Inventory.protected_source_files)
    if ($records.Count -eq 0) { throw 'Protected inventory contains no file records.' }
    foreach ($record in $records) {
        if ([string]::IsNullOrWhiteSpace([string]$record.path) -or [long]$record.bytes -lt 0 -or [string]$record.sha256 -notmatch '^[a-fA-F0-9]{64}$') {
            throw 'Protected inventory contains an invalid path, byte count, or SHA-256.'
        }
    }
    return $records
}

function Test-ProtectedInventory {
    param([Parameter(Mandatory = $true)][object[]]$Records)
    $failures = @()
    foreach ($record in $Records) {
        if (-not (Test-Path -LiteralPath $record.path -PathType Leaf)) {
            $failures += [string]$record.path
            continue
        }
        $file = Get-Item -LiteralPath $record.path
        if ($file.Length -ne [long]$record.bytes -or (Get-FileHash -LiteralPath $record.path -Algorithm SHA256).Hash -ne [string]$record.sha256) {
            $failures += [string]$record.path
        }
    }
    if ($failures.Count -gt 0) { throw "Protected inventory mismatch: $($failures -join ', ')" }
}

function Test-CandidateImageIdentity {
    param([string]$CandidateImageId, [string]$ImageInspect, [string]$HistoricalImageIdentity)
    if (-not $CandidateImageId) { return (($ImageInspect -split '\|' | Select-Object -First 3) -join '|') -eq $HistoricalImageIdentity }
    return $CandidateImageId -match '^sha256:[a-fA-F0-9]{64}$' -and
        $ImageInspect -match ('^' + [regex]::Escape($CandidateImageId) + '\|linux\|amd64\|10001:10001$')
}
