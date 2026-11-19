$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'acceptance_protection.ps1')

$id = 'sha256:' + ('a' * 64)
$inspect = "$id|linux|amd64|10001:10001"
if (-not (Test-CandidateImageIdentity -CandidateImageId $id -ImageInspect $inspect -HistoricalImageIdentity 'sha256:old|linux|amd64')) { throw 'Explicit candidate image ID should pass independently of historical pin.' }
if (Test-CandidateImageIdentity -CandidateImageId ('sha256:' + ('b' * 64)) -ImageInspect $inspect -HistoricalImageIdentity 'sha256:old|linux|amd64') { throw 'Mismatched explicit image ID must fail.' }
if (Test-CandidateImageIdentity -CandidateImageId 'not-a-digest' -ImageInspect $inspect -HistoricalImageIdentity 'sha256:old|linux|amd64') { throw 'Malformed explicit image ID must fail.' }
if (-not (Test-CandidateImageIdentity -CandidateImageId '' -ImageInspect "$id|linux|amd64|10001:10001" -HistoricalImageIdentity "$id|linux|amd64")) { throw 'Legacy pin must retain exact historical behavior.' }
if (Test-CandidateImageIdentity -CandidateImageId '' -ImageInspect "$id|linux|amd64|10001:10001" -HistoricalImageIdentity 'sha256:old|linux|amd64') { throw 'Legacy pin must reject a mismatch.' }
if (Test-CandidateImageIdentity -CandidateImageId $id -ImageInspect "$id|windows|amd64|10001:10001" -HistoricalImageIdentity '') { throw 'Wrong platform must fail.' }
if (Test-CandidateImageIdentity -CandidateImageId $id -ImageInspect "$id|linux|arm64|10001:10001" -HistoricalImageIdentity '') { throw 'Wrong architecture must fail.' }
if (Test-CandidateImageIdentity -CandidateImageId $id -ImageInspect "$id|linux|amd64|root" -HistoricalImageIdentity '') { throw 'Wrong runtime user must fail.' }

$temp = Join-Path ([IO.Path]::GetTempPath()) ("acceptance-protection-" + [guid]::NewGuid().ToString('N'))
try {
    [IO.File]::WriteAllText($temp, 'protected')
    $record = [pscustomobject]@{ path = $temp; bytes = 9; sha256 = (Get-FileHash $temp -Algorithm SHA256).Hash }
    Test-ProtectedInventory -Records @($record)
    [IO.File]::WriteAllText($temp, 'modified')
    $rejected = $false
    try { Test-ProtectedInventory -Records @($record) } catch { $rejected = $true }
    if (-not $rejected) { throw 'Modified protected file must fail.' }
    $bad = [pscustomobject]@{ baseline_kind = 'historical-baseline'; historical_publications = @($record); protected_source_files = @() }
    $rejected = $false
    try { Get-ProtectedInventoryRecords -Inventory $bad | Out-Null } catch { $rejected = $true }
if (-not $rejected) { throw 'Historical baseline must not be accepted as fresh inventory.' }
} finally { Remove-Item -LiteralPath $temp -Force }

$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'acceptance.ps1'), [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }

Write-Output 'ACCEPTANCE_PROTECTION_TESTS=PASS (7 image, 3 inventory assertions)'
