import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

export const POSTS_SCENARIO_BROWSER_CONTEXTS = 4;

export function assessPostsScenarioResourceCapacity({
  samples, sparkWorkloadActive, workloadsVerified, dockerWorkloadCount, wslWorkloadCount,
}) {
  const summary = summarizeResourceSamples(samples);
  const issues = [...summary.issues];

  if (sparkWorkloadActive !== false) issues.push('ISN-B Spark activity is active or could not be ruled out.');
  appendWorkloadInventoryIssues(issues, { workloadsVerified, dockerWorkloadCount, wslWorkloadCount });
  if (summary.minimumAvailablePhysicalBytes <= 0) issues.push('Available physical memory is exhausted.');
  if (summary.minimumCommitHeadroomBytes <= 0) issues.push('Available commit capacity is exhausted.');

  return {
    ...summary,
    safe: issues.length === 0,
    stage: 'A-read-only-inventory',
    issues,
    demand: null,
  };
}

export function assessPostsScenarioRuntimeCapacity({
  samples, requiredHeadroomBytes, sparkWorkloadActive, workloadsVerified, dockerWorkloadCount, wslWorkloadCount,
}) {
  const required = typeof requiredHeadroomBytes === 'number'
    ? { physical: requiredHeadroomBytes, commit: requiredHeadroomBytes }
    : { physical: requiredHeadroomBytes?.physical, commit: requiredHeadroomBytes?.commit };
  assert.ok(Number.isFinite(required.physical) && required.physical >= 0);
  assert.ok(Number.isFinite(required.commit) && required.commit >= 0);
  const summary = summarizeResourceSamples(samples);
  const issues = [...summary.issues];
  if (sparkWorkloadActive !== false) issues.push('ISN-B Spark activity is active or could not be ruled out.');
  appendWorkloadInventoryIssues(issues, { workloadsVerified, dockerWorkloadCount, wslWorkloadCount });
  if (summary.minimumAvailablePhysicalBytes < required.physical) {
    issues.push('Available physical memory fell below the measured runtime reserve.');
  }
  if (summary.minimumCommitHeadroomBytes < required.commit) {
    issues.push('Available commit capacity fell below the measured runtime reserve.');
  }
  return {
    ...summary,
    safe: issues.length === 0,
    stage: 'runtime-capacity',
    issues,
    requiredPhysicalHeadroomBytes: required.physical,
    requiredCommitHeadroomBytes: required.commit,
  };
}

function appendWorkloadInventoryIssues(issues, { workloadsVerified, dockerWorkloadCount, wslWorkloadCount }) {
  if (workloadsVerified !== true) issues.push('Docker/WSL workload inventory is incomplete.');
  if (!Number.isSafeInteger(dockerWorkloadCount) || dockerWorkloadCount < 0 ||
      !Number.isSafeInteger(wslWorkloadCount) || wslWorkloadCount < 0) {
    issues.push('Docker/WSL workload counts are unavailable or invalid.');
    return;
  }
  if (dockerWorkloadCount > 0) issues.push('Docker workloads are active.');
  if (wslWorkloadCount > 0) issues.push('WSL workloads are active.');
}

export function measurePostsScenarioObservedResourceDelta(baseline, samples) {
  assert.ok(Number.isFinite(baseline?.minimumAvailablePhysicalBytes) && baseline.minimumAvailablePhysicalBytes >= 0);
  assert.ok(Number.isFinite(baseline?.minimumCommitHeadroomBytes) && baseline.minimumCommitHeadroomBytes >= 0);
  const current = summarizeResourceSamples(samples);
  return {
    physical: Math.max(0, baseline.minimumAvailablePhysicalBytes - current.minimumAvailablePhysicalBytes),
    commit: Math.max(0, baseline.minimumCommitHeadroomBytes - current.minimumCommitHeadroomBytes),
  };
}

export function summarizeResourceSamples(samples) {
  const issues = [];
  const warnings = [];
  if (!Array.isArray(samples) || samples.length < 3) {
    return {
      issues: ['Fewer than three resource samples were collected.'],
      warnings,
      sampleCount: Array.isArray(samples) ? samples.length : 0,
      minimumAvailablePhysicalBytes: 0,
      minimumCommitHeadroomBytes: 0,
      maximumConsecutivePagingSamples: 0,
      sustainedPaging: true,
    };
  }

  let minimumAvailablePhysicalBytes = Number.POSITIVE_INFINITY;
  let minimumCommitHeadroomBytes = Number.POSITIVE_INFINITY;
  let currentPagingSamples = 0;
  let maximumConsecutivePagingSamples = 0;

  for (const sample of samples) {
    const values = [sample?.availablePhysicalBytes, sample?.committedBytes, sample?.commitLimitBytes,
      sample?.pagesInputPerSec, sample?.pagesOutputPerSec, sample?.pageReadsPerSec];
    if (!values.every((value) => Number.isFinite(value) && value >= 0) ||
        sample.commitLimitBytes < sample.committedBytes) {
      issues.push('Resource sample is missing valid physical-memory, commit, or paging measurements.');
      continue;
    }
    minimumAvailablePhysicalBytes = Math.min(minimumAvailablePhysicalBytes, sample.availablePhysicalBytes);
    minimumCommitHeadroomBytes = Math.min(
      minimumCommitHeadroomBytes,
      sample.commitLimitBytes - sample.committedBytes,
    );
    if (sample.pagesInputPerSec > 0 || sample.pagesOutputPerSec > 0 || sample.pageReadsPerSec > 0) {
      currentPagingSamples += 1;
      maximumConsecutivePagingSamples = Math.max(maximumConsecutivePagingSamples, currentPagingSamples);
    } else {
      currentPagingSamples = 0;
    }
  }

  const sustainedPaging = maximumConsecutivePagingSamples >= 3;
  if (sustainedPaging) warnings.push('Paging activity persisted across three consecutive samples; assess alongside headroom and observed stability.');
  if (!Number.isFinite(minimumAvailablePhysicalBytes) || !Number.isFinite(minimumCommitHeadroomBytes)) {
    issues.push('No complete resource samples were available.');
  }

  return {
    issues,
    warnings,
    sampleCount: samples.length,
    minimumAvailablePhysicalBytes: Number.isFinite(minimumAvailablePhysicalBytes) ? minimumAvailablePhysicalBytes : 0,
    minimumCommitHeadroomBytes: Number.isFinite(minimumCommitHeadroomBytes) ? minimumCommitHeadroomBytes : 0,
    maximumConsecutivePagingSamples,
    sustainedPaging,
  };
}

export function collectPostsScenarioResourceInventory({ sampleCount = 6, intervalSeconds = 10, ownedPids = [], verifyWorkloads = true } = {}) {
  assert.ok(Number.isSafeInteger(sampleCount) && sampleCount >= 3);
  assert.ok(Number.isSafeInteger(intervalSeconds) && intervalSeconds >= 0);
  assert.ok(ownedPids.every((pid) => Number.isSafeInteger(pid) && pid > 0));
  assert.equal(typeof verifyWorkloads, 'boolean');
  if (process.platform !== 'win32') throw new Error('Posts resource inventory requires Windows performance counters.');

  const script = String.raw`
$ErrorActionPreference = 'Stop'
$sampleCount = ${sampleCount}
$intervalSeconds = ${intervalSeconds}
$ownedPids = @(${ownedPids.join(',')})
$verifyWorkloads = ${verifyWorkloads ? '$true' : '$false'}
$all = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name)
$neo4jListenerPids = @(Get-NetTCPConnection -State Listen -LocalPort 7474,7687 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique)
$neo4jJavaPids = @($all | Where-Object {
  $neo4jListenerPids -contains [int]$_.ProcessId -and $_.Name -match '(?i)^java(w)?\.exe$'
} | Select-Object -ExpandProperty ProcessId)
$neo4jJavaFamilyPids = @($neo4jJavaPids)
do {
  $parents = @($all | Where-Object { $neo4jJavaFamilyPids -contains [int]$_.ProcessId } |
    Select-Object -ExpandProperty ParentProcessId | Where-Object { $_ -gt 0 -and $neo4jJavaFamilyPids -notcontains [int]$_ })
  $addedNeo4jParent = $false
  foreach ($parent in $parents) { $neo4jJavaFamilyPids += [int]$parent; $addedNeo4jParent = $true }
} while ($addedNeo4jParent)
$namedSpark = @($all | Where-Object { $_.Name -match '(?i)spark' })
$javaProcesses = @($all | Where-Object { $_.Name -match '(?i)^java(w)?\.exe$' })
$unclassifiedJavaProcesses = @($javaProcesses | Where-Object { $neo4jJavaFamilyPids -notcontains [int]$_.ProcessId })
$sparkWorkloadActive = if ($namedSpark.Count -gt 0) { $true } elseif ($unclassifiedJavaProcesses.Count -gt 0) { $null } else { $false }
$dockerStatus = 'not-checked'
$dockerWorkloads = @()
$wslStatus = 'not-checked'
$wslWorkloads = @()
if ($verifyWorkloads) {
  $dockerStatus = 'verified'
  if (Get-Command docker.exe -ErrorAction SilentlyContinue) {
    try {
      $dockerLines = @(& docker.exe stats --no-stream --format '{{.MemUsage}}' 2>$null)
      if ($LASTEXITCODE -ne 0) { $dockerStatus = 'unavailable' }
      else { $dockerWorkloads = @($dockerLines | Where-Object { $_ }) }
    } catch { $dockerStatus = 'unavailable' }
  } elseif (@($all | Where-Object { $_.Name -match '(?i)docker' }).Count -gt 0) {
    $dockerStatus = 'unavailable'
  }
  $wslStatus = 'verified'
  if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
    try {
      $wslLines = @(& wsl.exe --list --running --quiet 2>$null)
      if ($LASTEXITCODE -ne 0) { $wslStatus = 'unavailable' }
      else { $wslWorkloads = @($wslLines | Where-Object { $_ }) }
    } catch { $wslStatus = 'unavailable' }
  } elseif (@($all | Where-Object { $_.Name -match '(?i)wsl|vmmem' }).Count -gt 0) {
    $wslStatus = 'unavailable'
  }
}
$owned = @($ownedPids)
do {
  $children = @($all | Where-Object { $owned -contains [int]$_.ParentProcessId } |
    Select-Object -ExpandProperty ProcessId | Where-Object { $owned -notcontains [int]$_ })
  $added = $false
  foreach ($child in $children) { $owned += [int]$child; $added = $true }
} while ($added)
$ownedSet = @()
if ($owned.Count -gt 0) { $ownedSet = @(Get-Process -Id $owned -ErrorAction SilentlyContinue) }
$ownedTree = [pscustomobject]@{
  processCount = $ownedSet.Count
  measurementComplete = $ownedSet.Count -eq $owned.Count
  workingSetBytes = [int64](($ownedSet | Measure-Object WorkingSet64 -Sum).Sum)
  privateBytes = [int64](($ownedSet | Measure-Object PrivateMemorySize64 -Sum).Sum)
}
$samples = @()
for ($i = 0; $i -lt $sampleCount; $i++) {
  $memory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
  $samples += [pscustomobject]@{
    sampledAt = (Get-Date).ToUniversalTime().ToString('o')
    availablePhysicalBytes = [int64]$memory.AvailableBytes
    committedBytes = [int64]$memory.CommittedBytes
    commitLimitBytes = [int64]$memory.CommitLimit
    pagesInputPerSec = [double]$memory.PagesInputPersec
    pagesOutputPerSec = [double]$memory.PagesOutputPersec
    pageReadsPerSec = [double]$memory.PageReadsPersec
  }
  if ($i -lt ($sampleCount - 1)) { Start-Sleep -Seconds $intervalSeconds }
}
[pscustomobject]@{
  totalPhysicalBytes = [int64](Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize * 1KB
  samples = $samples
  sparkWorkloadActive = $sparkWorkloadActive
  unclassifiedJavaProcessCount = $unclassifiedJavaProcesses.Count
  neo4jJavaProcessCount = @($javaProcesses | Where-Object { $neo4jJavaFamilyPids -contains [int]$_.ProcessId }).Count
  dockerInventoryStatus = $dockerStatus
  workloadsVerified = $dockerStatus -eq 'verified' -and $wslStatus -eq 'verified'
  dockerWorkloadCount = $dockerWorkloads.Count
  dockerMemoryUsage = $dockerWorkloads
  wslInventoryStatus = $wslStatus
  wslWorkloadCount = $wslWorkloads.Count
  ownedProcessTree = $ownedTree
} | ConvertTo-Json -Depth 5 -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: Math.max(30_000, sampleCount * intervalSeconds * 1_000 + 30_000),
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('Could not collect a complete Windows Posts resource inventory.');
  let inventory;
  try { inventory = JSON.parse(result.stdout); }
  catch { throw new Error('Windows Posts resource inventory was incomplete or malformed.'); }
  assert.ok(Array.isArray(inventory.samples));
  return inventory;
}
