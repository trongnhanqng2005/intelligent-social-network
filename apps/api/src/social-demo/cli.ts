import { main } from './cli-main.js';

main().catch(() => {
  console.error('Social demo command refused or failed. Inspect local configuration and readiness; sensitive error details are suppressed.');
  process.exitCode = 1;
});
