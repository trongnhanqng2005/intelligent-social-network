import { createManifest, validateManifest } from './manifest.js';
import { loadOrCreateManifest, manifestPath, readManifest } from './manifest.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('social demo owner manifest', () => {
  it('creates distinct reserved-example emails, UUIDs, and strong credentials', () => {
    const manifest = createManifest('isn-dev', 'database-id');
    expect(manifest.users).toHaveLength(12);
    expect(new Set(manifest.users.map((user) => user.id)).size).toBe(12);
    expect(new Set(manifest.users.map((user) => user.email)).size).toBe(12);
    expect(manifest.users.every((user) => user.email.endsWith('@example.test') && user.password.length >= 32)).toBe(true);
    expect(validateManifest(manifest, 'isn-dev', 'database-id')).toEqual(manifest);
  });

  it('rejects wrong database, version, and incomplete ownership records', () => {
    const manifest = createManifest('isn-dev', 'database-id');
    expect(() => validateManifest(manifest, 'isn-test', 'database-id')).toThrow();
    expect(() => validateManifest(manifest, 'isn-dev', 'different-id')).toThrow();
    expect(() => validateManifest({ ...manifest, datasetVersion: 0 }, 'isn-dev', 'database-id')).toThrow();
    expect(() => validateManifest({ ...manifest, users: manifest.users.slice(1) }, 'isn-dev', 'database-id')).toThrow();
    expect(() => validateManifest({ ...manifest, users: manifest.users.map((u, i) =>
      i === 0 ? { ...u, email: 'owned-by-someone@example.test' } : u) }, 'isn-dev', 'database-id')).toThrow();
  });

  it('publishes one complete manifest under concurrent creation without clobbering it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'social-demo-manifest-'));
    const previous = process.cwd();
    try {
      process.chdir(root);
      const [first, second] = await Promise.all([
        loadOrCreateManifest('isn-dev', 'database-id'),
        loadOrCreateManifest('isn-dev', 'database-id'),
      ]);
      expect(first).toEqual(second);
      expect(await readManifest('isn-dev', 'database-id')).toEqual(first);
      expect(JSON.parse(await readFile(manifestPath(), 'utf8'))).toEqual(first);
    } finally {
      process.chdir(previous);
      await rm(root, { recursive: true, force: true });
    }
  });
});
