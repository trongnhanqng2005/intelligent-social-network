import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import { once } from 'node:events';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPostsScenarioExecutionTarget,
  assertPostsScenarioPortsFree,
  capturePostsScenarioOutput,
  getPostsScenarioOwnedPids,
  runPostsScenario,
  runPostsSerialCases,
  sanitizePostsScenarioFailure,
  summarizePostsPlaywrightReport,
} from '../fixtures/posts/scenario-runner.mjs';
import {
  assessPostsScenarioResourceCapacity,
  assessPostsScenarioRuntimeCapacity,
  collectPostsScenarioResourceInventory,
  measurePostsScenarioObservedResourceDelta,
} from '../fixtures/posts/resource-safety.mjs';
import { startPostsScenarioResourceMonitor } from '../fixtures/posts/resource-monitor.mjs';
import { runPostsAcceptancePreflight } from '../integration/neo4j/posts-acceptance-preflight.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const apiOrigin = 'http://127.0.0.1:3312';
const webOrigin = 'http://127.0.0.1:5182';
const groups = ['@lifecycle-security', '@visibility-feed', '@concurrency-recovery', '@ux-compatibility'];
const groupCases = {
  '@lifecycle-security': ['PF-00 V5 gate and real runtime readiness @lifecycle-security',
    'PF-01–PF-08 real authentication, security boundaries and Post lifecycle @lifecycle-security'],
  '@visibility-feed': ['PF-09–PF-14 current friendship visibility, privacy-safe profile lists and real Feed pagination @visibility-feed'],
  '@concurrency-recovery': [
    ...['PF-15', 'PF-16', 'PF-17'].map((name) => `${name} real concurrent mutations, stale recovery or session revocation @concurrency-recovery`),
    'PF-18 SIMULATED edit and Feed transport recovery @concurrency-recovery',
    'PF-18 SIMULATED aborted create requires reconciliation before retry @concurrency-recovery',
    ...['lost-response', 'explicit-unknown'].map((name) => `PF-19 SIMULATED ${name} reconciliation @concurrency-recovery`),
    'PF-20 controlled stale Feed delivery and route changes @concurrency-recovery'],
  '@ux-compatibility': ['PF-21–PF-23 approved Weylume UI, responsive/accessibility checks and V5 compatibility @ux-compatibility'],
};
const runControlDirectory = resolve(root, '.artifacts/playwright/posts/run-control');
const runOutputDirectory = resolve(root, '.artifacts/playwright/posts');
const resourceEvidenceDirectory = resolve(runOutputDirectory, 'resource-preflight');

async function main(arguments_) {
  const resourceProbeOnly = arguments_.length === 1 && arguments_[0] === '--resource-probe-only';
  const remaining = arguments_.length === 1 && arguments_[0] === '--remaining';
  const remainingCases = arguments_.length === 1 && arguments_[0] === '--remaining-cases';
  const requestedGroup = remainingCases ? '@concurrency-recovery' : readGroup(resourceProbeOnly || remaining ? [] : arguments_);
  const groupSelection = remaining
    ? groups.slice(1) : requestedGroup ? [requestedGroup] : groups;
  let services = [];
  let invocation;
  let resourceEvidence;
  const groupResults = [];
  const serviceOutput = new Map();

  return runPostsScenario({
    preflight: async () => {
      const branch = readGit(['branch', '--show-current']);
      if (!resourceProbeOnly) {
        assertPostsScenarioExecutionTarget({
          environment: process.env,
          cwd: process.cwd(),
          repositoryRoot: root,
          branch,
          baselineAncestor: gitAncestorExists('07b9b385321716a514ecef99ff0184e8f903fac2'),
        });
      } else {
        assert.equal(branch, 'feature/posts-feed');
        assert.equal(gitAncestorExists('07b9b385321716a514ecef99ff0184e8f903fac2'), true);
      }
      assert.equal(normalizePath(process.cwd()), normalizePath(root));
      let inventory;
      try {
        inventory = collectPostsScenarioResourceInventory();
        await assertPostsScenarioPortsFree([3312, 5182]);
        assertProjectIgnoredPath(resourceEvidenceDirectory);
        resourceEvidence = assessPostsScenarioResourceCapacity({
          samples: inventory.samples,
          sparkWorkloadActive: inventory.sparkWorkloadActive,
          workloadsVerified: inventory.workloadsVerified,
          dockerWorkloadCount: inventory.dockerWorkloadCount,
          wslWorkloadCount: inventory.wslWorkloadCount,
        });
        resourceEvidence.path = await writeResourceEvidence(inventory, resourceEvidence);
      } catch (error) {
        throw Object.assign(error, { stage: 'resource-stage-a' });
      }
      if (!resourceEvidence.safe) {
        throw Object.assign(new Error('Measured resource capacity is insufficient or inconclusive.'), {
          stage: 'resource-stage-a',
        });
      }
      const gate = resourceProbeOnly
        ? {
          databaseId: null,
          schemaVersion: null,
          dataFingerprint: null,
          dataCounts: null,
          schemaFingerprint: null,
          privilegeFingerprint: null,
          writesPerformed: false,
        }
        : await runPostsAcceptancePreflight();
      if (!resourceProbeOnly) {
        assert.equal(gate.writesPerformed, false);
        assert.equal(gate.databaseId, '336953E435C22F87EF53AAF1A42024422029E9ECB305B7108694A6EEDC37A786');
      }
      try { await access(resolve(root, 'apps/api/dist/main.js')); }
      catch { throw Object.assign(new Error('An existing API build is required before guarded acceptance.'), { stage: 'api-build-missing' }); }
      gate.resourceAssessment = resourceEvidence;
      gate.resourceInventory = inventory;
      gate.resourceEvidencePath = resourceEvidence.path;
      return gate;
    },
    prepare: async (gate) => {
      const runId = randomUUID();
      const token = resourceProbeOnly ? null : randomBytes(32).toString('hex');
      const outputDirectory = resolve(runOutputDirectory, runId);
      const keyDirectory = resolve(outputDirectory, 'auth-keys');
      const tempDirectory = resolve(outputDirectory, 'tmp');
      const markerPath = resolve(runControlDirectory, `${runId}.json`);
      assertProjectIgnoredPath(outputDirectory);
      assertProjectIgnoredPath(keyDirectory);
      assertProjectIgnoredPath(tempDirectory);
      if (!resourceProbeOnly) assertProjectIgnoredPath(markerPath);
      const marker = resourceProbeOnly ? null : {
        tokenHash: createHash('sha256').update(token).digest('hex'),
        runnerPid: process.pid,
        expiresAt: Date.now() + 2 * 60 * 60_000,
        databaseId: gate.databaseId,
        runId,
      };
      const authEnvironment = {
        AUTH_PRIVATE_KEY_PATH: resolve(keyDirectory, 'private.pem'),
        AUTH_PUBLIC_KEY_PATH: resolve(keyDirectory, 'public.pem'),
        AUTH_CSRF_SECRET_PATH: resolve(keyDirectory, 'csrf.secret'),
        AUTH_KEY_ID: 'posts-scenario-runtime',
        AUTH_ISSUER: apiOrigin,
        AUTH_AUDIENCE: 'intelligent-social-network-web',
        AUTH_WEB_ORIGIN: webOrigin,
      };
      invocation = { runId, token, marker, markerPath, outputDirectory, keyDirectory, tempDirectory, authEnvironment, gate, resourceProbeOnly };
      await mkdir(keyDirectory, { recursive: true, mode: 0o700 });
      await mkdir(tempDirectory, { recursive: true, mode: 0o700 });
      const keys = generateKeyPairSync('rsa', {
        modulusLength: 3072,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      await Promise.all([
        writeFile(authEnvironment.AUTH_PRIVATE_KEY_PATH, keys.privateKey, { flag: 'wx', mode: 0o600 }),
        writeFile(authEnvironment.AUTH_PUBLIC_KEY_PATH, keys.publicKey, { flag: 'wx', mode: 0o600 }),
        writeFile(authEnvironment.AUTH_CSRF_SECRET_PATH, randomBytes(32), { flag: 'wx', mode: 0o600 }),
      ]);
      if (!resourceProbeOnly) {
        assertProjectIgnoredPath(runControlDirectory);
        await mkdir(runControlDirectory, { recursive: true, mode: 0o700 });
        await writeFile(markerPath, JSON.stringify(marker), { flag: 'wx', mode: 0o600 });
      }
      await writeRunSummary(invocation, groupResults, true);
    },
    start: async () => {
      const localProcessEnvironment = pickProcessEnvironment(process.env);
      const apiEnvironment = resourceProbeOnly
        ? {
          ...localProcessEnvironment,
          ...invocation.authEnvironment,
          NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3312',
          NEO4J_URI: 'neo4j://127.0.0.1:1', NEO4J_DATABASE: 'isn-test',
          NEO4J_TEST_USERNAME: 'resource-probe-no-database-access',
          NEO4J_TEST_PASSWORD: 'resource-probe-no-database-access',
        }
        : { ...process.env, ...invocation.authEnvironment };
      delete apiEnvironment.NEO4J_USERNAME;
      delete apiEnvironment.NEO4J_PASSWORD;
      delete apiEnvironment.ISN_TEST_WRITE_WINDOW;
      delete apiEnvironment.ISN_POSTS_SCENARIO_RUNNER_TOKEN;
      if (!resourceProbeOnly) {
        Object.assign(apiEnvironment, {
          NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3312',
          NEO4J_DATABASE: 'isn-test',
          NEO4J_USERNAME: '', NEO4J_PASSWORD: '',
        });
      }
      Object.assign(apiEnvironment, { TEMP: invocation.tempDirectory, TMP: invocation.tempDirectory });
      const webEnvironment = resourceProbeOnly ? { ...localProcessEnvironment } : { ...process.env };
      for (const key of Object.keys(webEnvironment)) {
        if (/^(?:NEO4J_|AUTH_|ISN_TEST_WRITE_WINDOW|ISN_POSTS_SCENARIO)/u.test(key)) delete webEnvironment[key];
      }
      Object.assign(webEnvironment, {
        NODE_ENV: 'development', ISN_WEB_PORT: '5182', VITE_API_BASE_URL: '/api',
        API_PROXY_TARGET: apiOrigin,
        TEMP: invocation.tempDirectory,
        TMP: invocation.tempDirectory,
      });
      const api = spawn(process.execPath, [resolve(root, 'apps/api/dist/main.js')], {
        cwd: root, env: apiEnvironment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      services.push(api);
      serviceOutput.set(api, { name: 'API', read: capturePostsScenarioOutput(api) });
      const vite = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5182', '--strictPort'], {
        cwd: resolve(root, 'apps/web'), env: webEnvironment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      services.push(vite);
      serviceOutput.set(vite, { name: 'Web', read: capturePostsScenarioOutput(vite) });
      try {
        await Promise.all([waitForHttp(`${apiOrigin}/health`, api), waitForHttp(webOrigin, vite)]);
      } catch {
        const diagnostic = services.map((service) => {
          const output = serviceOutput.get(service);
          const captured = output?.read();
          const details = [captured?.stdout, captured?.stderr].filter(Boolean).join('\n');
          return details ? `${output.name}: ${sanitizeExecutionOutput(details)}` : '';
        }).filter(Boolean).join('\n');
        throw Object.assign(new Error('Invocation-owned API/Web startup failed or timed out.'), {
          stage: 'service-startup',
          ...(diagnostic ? { diagnostic } : {}),
        });
      }
      if (!resourceProbeOnly) {
        const ready = await fetch(`${apiOrigin}/ready`, { signal: AbortSignal.timeout(5_000) });
        const body = await ready.json();
        assert.equal(ready.status, 200);
        assert.deepEqual(body, { status: 'ready', database: 'isn-test', schemaVersion: 5 });
      }

      const stageB = collectPostsScenarioResourceInventory({
        sampleCount: 3, intervalSeconds: 2, ownedPids: services.map((service) => service.pid).filter(Number.isSafeInteger),
      });
      const stageBMeasuredDemand = measurePostsScenarioObservedResourceDelta(
        invocation.gate.resourceAssessment,
        stageB.samples,
      );
      const stageBAssessment = assessPostsScenarioRuntimeCapacity({
        samples: stageB.samples,
        requiredHeadroomBytes: stageBMeasuredDemand,
        sparkWorkloadActive: stageB.sparkWorkloadActive,
        workloadsVerified: stageB.workloadsVerified,
        dockerWorkloadCount: stageB.dockerWorkloadCount,
        wslWorkloadCount: stageB.wslWorkloadCount,
      });
      invocation.resourceStageB = {
        assessment: stageBAssessment,
        measuredDemandBytes: stageBMeasuredDemand,
        ownedProcessTree: stageB.ownedProcessTree,
        workloads: summarizeResourceWorkloads(stageB),
      };
      if (!stageBAssessment.safe || !stageB.ownedProcessTree.measurementComplete ||
          stageB.ownedProcessTree.workingSetBytes <= 0 || stageB.ownedProcessTree.privateBytes <= 0) {
        throw Object.assign(new Error('Measured API/Web startup capacity is insufficient or inconclusive.'), { stage: 'resource-stage-b' });
      }

      const stageC = await runPostsResourceBrowserProbe(invocation.tempDirectory, stageB);
      const measuredPeakDemandBytes = measurePostsScenarioObservedResourceDelta(
        invocation.gate.resourceAssessment,
        stageC.samples,
      );
      const stageCAssessment = assessPostsScenarioRuntimeCapacity({
        samples: stageC.samples,
        requiredHeadroomBytes: measuredPeakDemandBytes,
        sparkWorkloadActive: stageC.sparkWorkloadActive,
        workloadsVerified: stageC.workloadsVerified,
        dockerWorkloadCount: stageC.dockerWorkloadCount,
        wslWorkloadCount: stageC.wslWorkloadCount,
      });
      invocation.resourceStageC = {
        assessment: stageCAssessment,
        samples: stageC.samples,
        browserContexts: stageC.browserContexts,
        pages: stageC.pages,
        measuredPeakDemandBytes,
        ownedProcessTree: stageC.ownedProcessTree,
        workloads: summarizeResourceWorkloads(stageC),
        workloadInventorySource: stageC.workloadInventorySource,
      };
      if (!stageCAssessment.safe || stageC.browserContexts !== 4 || stageC.pages !== 5 ||
          !stageC.ownedProcessTree.measurementComplete ||
          stageC.ownedProcessTree.workingSetBytes <= 0 || stageC.ownedProcessTree.privateBytes <= 0) {
        throw Object.assign(new Error('Measured browser capacity is insufficient or inconclusive.'), { stage: 'resource-stage-c' });
      }
      invocation.measuredPeakDemandBytes = measuredPeakDemandBytes;

      const postProbe = collectPostsScenarioResourceInventory({ sampleCount: 3, intervalSeconds: 2 });
      const postProbeAssessment = assessPostsScenarioRuntimeCapacity({
        samples: postProbe.samples,
        requiredHeadroomBytes: measuredPeakDemandBytes,
        sparkWorkloadActive: postProbe.sparkWorkloadActive,
        workloadsVerified: postProbe.workloadsVerified,
        dockerWorkloadCount: postProbe.dockerWorkloadCount,
        wslWorkloadCount: postProbe.wslWorkloadCount,
      });
      invocation.resourceStageC.postProbe = postProbeAssessment;
      if (!postProbeAssessment.safe) {
        throw Object.assign(new Error('Post-probe capacity no longer covers the measured runtime peak.'), { stage: 'resource-stage-c' });
      }
      await writeRunSummary(invocation, groupResults);
    },
    run: async () => {
      if (resourceProbeOnly) return [];
      const selectedCases = groupSelection.flatMap((group) => groupCases[group]
        .filter((name) => !remainingCases || /^(PF-16 |PF-18 SIMULATED edit and Feed|PF-19 SIMULATED lost-response|PF-20 controlled)/u.test(name))
        .map((name) => ({ group, name })));
      await runPostsSerialCases(selectedCases, async ({ group, name }) => {
        const execution = await runPlaywrightGroup(name, invocation, services);
        const groupResult = {
          group,
          scenario: name,
          status: execution.exitCode !== 0 || execution.reportStatus !== 'CAPTURED'
            ? 'FAIL' : execution.resourceStatus.safe ? 'PASS' : 'BLOCKED',
          exitCode: execution.exitCode,
          reportStatus: execution.reportStatus,
          testCounts: execution.report.stats,
          tests: execution.report.tests,
          process: execution.process,
          resourceStatus: execution.resourceStatus,
          postGroupPreflight: 'PENDING',
          cleanup: 'PENDING',
        };
        groupResults.push(groupResult);
        await writeRunSummary(invocation, groupResults);
        try {
          assert.equal(services.length, 2);
          assert.ok(services.every((service) => service.exitCode === null && service.signalCode === null),
            'Invocation-owned API and Web services must remain active through the group checkpoint.');
          const afterGroup = await runPostsAcceptancePreflight({ requireFreePorts: false });
          assertSamePreservationState(invocation.gate, afterGroup);
          groupResult.postGroupPreflight = 'PASS';
          groupResult.cleanup = 'PASS';
        } catch (error) {
          groupResult.postGroupPreflight = 'FAIL';
          groupResult.cleanup = 'NOT_VERIFIED';
          groupResult.preflightFailureStage = error?.stage ?? 'preservation-comparison';
          await writeRunSummary(invocation, groupResults);
          throw Object.assign(error, { runnerStage: 'post-group-preservation', runId: invocation.runId });
        }
        await writeRunSummary(invocation, groupResults);
        return execution;
      });
      return groupResults;
    },
    stop: async () => {
      await Promise.all(services.splice(0).reverse().map(stopOwnedProcess));
      if (!resourceProbeOnly) {
        const finalGate = await runPostsAcceptancePreflight();
        assertSamePreservationState(invocation.gate, finalGate);
        invocation.finalGate = finalGate;
      }
    },
    dispose: async () => {
      if (invocation) {
        if (invocation.markerPath) await rm(invocation.markerPath, { force: true });
        await rm(invocation.keyDirectory, { recursive: true, force: true });
        await rm(invocation.tempDirectory, { recursive: true, force: true });
        await writeRunSummary(invocation, groupResults);
      }
    },
  }).catch(async (error) => {
    if (invocation) {
      invocation.runnerFailure = summarizeRunnerFailure(error);
      try { await writeRunSummary(invocation, groupResults); }
      catch (summaryError) {
        invocation.runnerFailure.summaryWriteFailure = sanitizePostsScenarioFailure(summaryError);
      }
    }
    throw Object.assign(error, { runId: invocation?.runId });
  }).then((result) => {
    const failed = result.some((item) => item.status !== 'PASS');
    process.stdout.write(`${JSON.stringify({
      runId: invocation?.runId,
      mode: resourceProbeOnly ? 'resource-probe-only' : 'acceptance',
      resourceProbe: resourceProbeOnly ? (invocation?.resourceStageC ? 'PASS' : 'BLOCKED') : undefined,
      groups: result,
      finalPreservation: resourceProbeOnly ? 'NOT_APPLICABLE' : invocation?.finalGate ? 'PASS' : 'BLOCKED',
    })}\n`);
    return failed ? 1 : 0;
  });
}

function readGroup(args) {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === '--group' && groups.includes(args[1])) return args[1];
  throw new Error('Unsupported Posts scenario runner arguments.');
}

async function runPlaywrightGroup(scenario, invocation, services) {
  const cli = resolve(root, 'node_modules/@playwright/test/cli.js');
  const config = resolve(root, 'tests/e2e/posts.playwright.config.mts');
  const childEnvironment = {
    ...process.env,
    ...invocation.authEnvironment,
    TEMP: invocation.tempDirectory,
    TMP: invocation.tempDirectory,
    ISN_POSTS_SCENARIO_RUNNER_TOKEN: invocation.token,
    ISN_POSTS_SCENARIO_DATABASE_ID: invocation.gate.databaseId,
    ISN_POSTS_SCENARIO_GATE_FILE: invocation.markerPath,
  };
  delete childEnvironment.NEO4J_USERNAME;
  delete childEnvironment.NEO4J_PASSWORD;
  const grep = `${scenario.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`;
  const child = spawn(process.execPath, [cli, 'test', '--config', config, '--grep', grep, '--reporter=json'], {
    cwd: root, env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const resourceMonitor = startResourceMonitor(invocation, getPostsScenarioOwnedPids(services, child.pid));
  let output = '';
  let errorOutput = '';
  let outputTruncated = false;
  let processError;
  child.once('error', (error) => { processError = error; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    if (output.length + chunk.length <= 10 * 1024 * 1024) output += chunk;
    else outputTruncated = true;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { errorOutput = appendBoundedTail(errorOutput, chunk, 20_000); });
  const [code, signal] = await once(child, 'close').catch((error) => {
    processError ??= error;
    return [null, null];
  });
  const resourceStatus = await resourceMonitor.stop();
  let report;
  let reportStatus = 'CAPTURED';
  try {
    if (outputTruncated) throw new Error('report limit exceeded');
    report = summarizePostsPlaywrightReport(JSON.parse(output));
    assert.equal(report.tests.length, 1, 'Each guarded invocation must execute exactly one scenario.');
  } catch {
    reportStatus = 'UNAVAILABLE';
    report = { stats: { expected: 0, skipped: 0, unexpected: 0, flaky: 0 }, tests: [] };
  }
  await removeGeneratedErrorContexts(invocation.outputDirectory);
  return {
    exitCode: typeof code === 'number' ? code : 1,
    reportStatus,
    report,
    process: {
      exitCode: code,
      signal,
      ...(processError ? { error: summarizeRunnerFailure(processError) } : {}),
      ...(errorOutput ? { stderr: sanitizeExecutionOutput(errorOutput) } : {}),
      ...(reportStatus !== 'CAPTURED' && output ? { stdout: sanitizeExecutionOutput(output) } : {}),
    },
    resourceStatus,
  };
}

function startResourceMonitor(invocation, ownedPids) {
  return startPostsScenarioResourceMonitor({
    onUnsafe: () => unlinkSync(invocation.markerPath),
    sample: () => {
      const inventory = collectPostsScenarioResourceInventory({
        sampleCount: 3,
        intervalSeconds: 2,
        ownedPids,
      });
      return assessPostsScenarioRuntimeCapacity({
        samples: inventory.samples,
        requiredHeadroomBytes: invocation.measuredPeakDemandBytes,
        sparkWorkloadActive: inventory.sparkWorkloadActive,
        workloadsVerified: inventory.workloadsVerified,
        dockerWorkloadCount: inventory.dockerWorkloadCount,
        wslWorkloadCount: inventory.wslWorkloadCount,
      });
    },
  });
}

async function runPostsResourceBrowserProbe(tempDirectory, workloadBaseline) {
  const script = resolve(root, 'tests/e2e/posts-resource-probe.mjs');
  const safeEnvironment = {
    ...pickProcessEnvironment(process.env),
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}),
    TEMP: tempDirectory,
    TMP: tempDirectory,
  };
  const child = spawn(process.execPath, [script], {
    cwd: root, env: safeEnvironment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const readOutput = capturePostsScenarioOutput(child, 1_000_000);
  let processError;
  child.once('error', (error) => { processError = error; });
  const [code] = await once(child, 'close').catch((error) => {
    processError ??= error;
    return [null];
  });
  const output = readOutput();
  if (code !== 0 || processError || output.stdout.length >= 1_000_000) {
    const diagnostic = [output.stderr, output.stdout].filter(Boolean).join('\n');
    throw Object.assign(new Error('Read-only browser capacity probe failed.'), {
      stage: 'resource-stage-c',
      ...(processError ? { cause: processError } : {}),
      ...(diagnostic ? { diagnostic: sanitizeExecutionOutput(diagnostic) } : {}),
    });
  }
  try {
    const result = JSON.parse(output.stdout);
    assert.equal(result.status, 'PASS');
    return {
      ...result,
      workloadsVerified: workloadBaseline.workloadsVerified,
      dockerInventoryStatus: workloadBaseline.dockerInventoryStatus,
      dockerWorkloadCount: workloadBaseline.dockerWorkloadCount,
      wslInventoryStatus: workloadBaseline.wslInventoryStatus,
      wslWorkloadCount: workloadBaseline.wslWorkloadCount,
      workloadInventorySource: 'stage-b-before-browser-probe',
    };
  } catch (cause) {
    throw Object.assign(new Error('Read-only browser capacity evidence was incomplete.'), {
      stage: 'resource-stage-c',
      ...([output.stderr, output.stdout].filter(Boolean).length
        ? { diagnostic: sanitizeExecutionOutput([output.stderr, output.stdout].filter(Boolean).join('\n')) }
        : {}),
      cause,
    });
  }
}

async function removeGeneratedErrorContexts(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await removeGeneratedErrorContexts(path);
    else if (entry.name === 'error-context.md') await rm(path);
  }
}

async function writeRunSummary(invocation, groupResults, exclusiveCreate = false) {
  const summary = {
    runId: invocation.runId,
    target: invocation.resourceProbeOnly ? 'NO_DATABASE_ACCESS' : 'isn-test',
    databaseId: invocation.gate.databaseId,
    schemaVersion: invocation.gate.schemaVersion,
    initialDataFingerprint: invocation.gate.dataFingerprint,
    finalDataFingerprint: invocation.finalGate?.dataFingerprint ?? null,
    initialSchemaFingerprint: invocation.gate.schemaFingerprint,
    finalSchemaFingerprint: invocation.finalGate?.schemaFingerprint ?? null,
    initialPrivilegeFingerprint: invocation.gate.privilegeFingerprint,
    finalPrivilegeFingerprint: invocation.finalGate?.privilegeFingerprint ?? null,
    runnerFailure: invocation.runnerFailure ?? null,
    resource: {
      stageA: invocation.gate.resourceAssessment,
      evidencePath: invocation.gate.resourceEvidencePath,
      workloads: {
        sparkWorkloadActive: invocation.gate.resourceInventory.sparkWorkloadActive,
        unclassifiedJavaProcessCount: invocation.gate.resourceInventory.unclassifiedJavaProcessCount,
        neo4jJavaProcessCount: invocation.gate.resourceInventory.neo4jJavaProcessCount,
        dockerInventoryStatus: invocation.gate.resourceInventory.dockerInventoryStatus,
        workloadsVerified: invocation.gate.resourceInventory.workloadsVerified,
        dockerWorkloadCount: invocation.gate.resourceInventory.dockerWorkloadCount,
        wslInventoryStatus: invocation.gate.resourceInventory.wslInventoryStatus,
        wslWorkloadCount: invocation.gate.resourceInventory.wslWorkloadCount,
      },
      stageB: invocation.resourceStageB ?? null,
      stageC: invocation.resourceStageC ?? null,
    },
    groups: groupResults,
  };
  await writeFile(resolve(invocation.outputDirectory, 'run-summary.json'), JSON.stringify(summary, null, 2), {
    ...(exclusiveCreate ? { flag: 'wx', mode: 0o600 } : {}),
  });
}

async function waitForHttp(url, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Invocation-owned application process exited before becoming healthy.');
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* Retry until the bounded startup deadline. */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Invocation-owned application did not become healthy before the startup deadline.');
}

async function stopOwnedProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((resolveDelay) => setTimeout(() => resolveDelay(false), 5_000)),
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

function assertSamePreservationState(initial, current) {
  assert.equal(current.databaseId, initial.databaseId);
  assert.equal(current.schemaVersion, initial.schemaVersion);
  assert.equal(current.dataFingerprint, initial.dataFingerprint);
  assert.deepEqual(current.dataCounts, initial.dataCounts);
  assert.equal(current.schemaFingerprint, initial.schemaFingerprint);
  assert.equal(current.privilegeFingerprint, initial.privilegeFingerprint);
  assert.equal(current.writesPerformed, false);
}

function readGit(args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).stdout.trim();
}

function gitAncestorExists(commit) {
  return spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
    cwd: root, stdio: 'ignore', windowsHide: true,
  }).status === 0;
}

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase();
}

function assertProjectIgnoredPath(path) {
  const relativePath = relative(root, path);
  assert.ok(relativePath && relativePath !== '..' && !relativePath.startsWith(`..${sep}`),
    'Generated Posts artifacts must remain inside the approved worktree.');
  const result = spawnSync('git', ['check-ignore', '--quiet', '--', relativePath], {
    cwd: root,
    stdio: 'ignore',
    windowsHide: true,
  });
  assert.equal(result.status, 0, 'Generated Posts artifacts must be Git-ignored before creation.');
}

function summarizeResourceWorkloads(inventory) {
  return {
    sparkWorkloadActive: inventory.sparkWorkloadActive,
    unclassifiedJavaProcessCount: inventory.unclassifiedJavaProcessCount,
    neo4jJavaProcessCount: inventory.neo4jJavaProcessCount,
    workloadsVerified: inventory.workloadsVerified,
    dockerInventoryStatus: inventory.dockerInventoryStatus,
    dockerWorkloadCount: inventory.dockerWorkloadCount,
    wslInventoryStatus: inventory.wslInventoryStatus,
    wslWorkloadCount: inventory.wslWorkloadCount,
  };
}

function summarizeRunnerFailure(error, depth = 0) {
  const summary = {
    name: typeof error?.name === 'string' ? error.name : 'Error',
    message: sanitizePostsScenarioFailure(error),
    ...(typeof error?.code === 'string' ? { code: error.code } : {}),
    ...(typeof error?.stage === 'string' ? { stage: error.stage } : {}),
    ...(typeof error?.diagnostic === 'string' ? { diagnostic: sanitizeExecutionOutput(error.diagnostic) } : {}),
    ...(typeof error?.stack === 'string' ? { stack: sanitizeExecutionOutput(error.stack) } : {}),
  };
  if (depth < 2 && Array.isArray(error?.errors)) {
    summary.errors = error.errors.slice(0, 4).map((nested) => summarizeRunnerFailure(nested, depth + 1));
  }
  return summary;
}

function sanitizeExecutionOutput(output) {
  const tail = String(output).split(/\r?\n/u).slice(-20).join('\n');
  return sanitizePostsScenarioFailure(tail);
}

function appendBoundedTail(current, chunk, limit) {
  const combined = current + chunk;
  return combined.length <= limit ? combined : combined.slice(-limit);
}

async function writeResourceEvidence(inventory, assessment) {
  assertProjectIgnoredPath(resourceEvidenceDirectory);
  await mkdir(resourceEvidenceDirectory, { recursive: true, mode: 0o700 });
  const fileName = `${new Date().toISOString().replaceAll(':', '-')}.json`;
  const path = resolve(resourceEvidenceDirectory, fileName);
  await writeFile(path, JSON.stringify({
    totalPhysicalBytes: inventory.totalPhysicalBytes,
    samples: inventory.samples,
    sparkWorkloadActive: inventory.sparkWorkloadActive,
    unclassifiedJavaProcessCount: inventory.unclassifiedJavaProcessCount,
    neo4jJavaProcessCount: inventory.neo4jJavaProcessCount,
    dockerInventoryStatus: inventory.dockerInventoryStatus,
    workloadsVerified: inventory.workloadsVerified,
    dockerWorkloadCount: inventory.dockerWorkloadCount,
    dockerMemoryUsage: inventory.dockerMemoryUsage,
    wslInventoryStatus: inventory.wslInventoryStatus,
    wslWorkloadCount: inventory.wslWorkloadCount,
    assessment,
  }, null, 2), { flag: 'wx', mode: 0o600 });
  return path;
}

function pickProcessEnvironment(environment) {
  return Object.fromEntries([
    'PATH', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'HOME',
  ].filter((key) => environment[key] !== undefined).map((key) => [key, environment[key]]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      runner: 'BLOCKED_OR_FAILED',
      stage: error?.stage ?? error?.runnerStage ?? 'execution',
      runId: error?.runId ?? null,
      error: summarizeRunnerFailure(error),
    })}\n`);
    process.exitCode = 1;
  });
}
