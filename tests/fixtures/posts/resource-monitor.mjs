export function startPostsScenarioResourceMonitor({ sample, onUnsafe = () => {}, intervalMs = 30_000 }) {
  let checkPromise;
  let assessment;
  let checks = 0;
  let stopped = false;

  const timer = setInterval(runCheck, intervalMs);
  timer.unref();
  runCheck();

  function runCheck() {
    if (stopped || checkPromise || (assessment && !assessment.safe)) return;
    checkPromise = Promise.resolve().then(sample).then((result) => {
      checks += 1;
      assessment = result;
    }).catch(() => {
      assessment = { safe: false, stage: 'runtime-monitor', issues: ['Resource monitoring became inconclusive.'] };
    }).finally(() => {
      checkPromise = undefined;
      if (assessment && !assessment.safe) {
        clearInterval(timer);
        try { onUnsafe(); } catch {
          assessment = { safe: false, stage: 'runtime-monitor', issues: ['Could not revoke the scenario handoff.'] };
        }
      }
    });
  }

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (checkPromise) await checkPromise;
      if (!assessment) {
        return {
          safe: false,
          stage: 'runtime-monitor',
          checks,
          issues: ['No runtime resource sample completed during the Playwright group.'],
        };
      }
      return { ...assessment, checks };
    },
  };
}
