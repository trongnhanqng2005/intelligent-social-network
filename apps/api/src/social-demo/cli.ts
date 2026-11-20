import { SocialDemoRefusal } from './accounts.js';

async function run(): Promise<void> {
  process.loadEnvFile(process.env.ISN_API_ENV_FILE ?? '.env');
  const { main } = await import('./cli-main.js');
  await main();
}

run().catch((error: unknown) => {
  console.error(error instanceof SocialDemoRefusal ? error.message :
    'Social demo failed. Check target, readiness, ownership, and local configuration.');
  process.exitCode = 1;
});
