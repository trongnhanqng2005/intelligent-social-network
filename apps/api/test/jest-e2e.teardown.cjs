const { readFile, realpath, rm } = require('node:fs/promises');
const { dirname, join } = require('node:path');

module.exports = async function removeEphemeralAuthKeys() {
  const owned = globalThis.__ISN_API_E2E_AUTH_KEYS__;
  if (!owned) return;
  const root = await realpath(join(__dirname, '..', '.artifacts'));
  const directory = await realpath(owned.directory);
  if (dirname(directory) !== root || await readFile(join(directory, '.owner'), 'utf8') !== owned.nonce) {
    throw new Error(`Refusing to remove unowned API E2E keys: ${owned.directory}`);
  }
  await rm(directory, { recursive: true });
  delete globalThis.__ISN_API_E2E_AUTH_KEYS__;
};
