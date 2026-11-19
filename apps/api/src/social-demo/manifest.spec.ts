import { createManifest, validateManifest } from './manifest.js';
import { loadOrCreateManifest, manifestPath, readManifest } from './manifest.js';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
    try {
      const [first, second] = await Promise.all([
        loadOrCreateManifest('isn-dev', 'database-id', root),
        loadOrCreateManifest('isn-dev', 'database-id', root),
      ]);
      expect(first).toEqual(second);
      expect(await readManifest('isn-dev', 'database-id', root)).toEqual(first);
      expect(JSON.parse(await readFile(manifestPath(root), 'utf8'))).toEqual(first);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked manifest directory without writing through it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'social-demo-manifest-'));
    const outside = await mkdtemp(join(tmpdir(), 'social-demo-outside-'));
    try {
      await mkdir(join(root, '.weylume'));
      await symlink(outside, join(root, '.weylume', 'social-demo-data'), 'junction');
      await expect(loadOrCreateManifest('isn-dev', 'database-id', root)).rejects.toThrow(/real directory/u);
      expect(await readFile(join(outside, 'owner-manifest.json')).catch(() => undefined)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked .weylume directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'social-demo-manifest-'));
    const outside = await mkdtemp(join(tmpdir(), 'social-demo-outside-'));
    try {
      await symlink(outside, join(root, '.weylume'), 'junction');
      await expect(loadOrCreateManifest('isn-dev', 'database-id', root)).rejects.toThrow(/real directory/u);
      expect(await readFile(join(outside, 'social-demo-data', 'owner-manifest.json')).catch(() => undefined)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects a non-regular manifest before reading or replacing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'social-demo-manifest-'));
    try {
      const directory = join(root, '.weylume', 'social-demo-data');
      await mkdir(join(root, '.weylume'));
      await mkdir(directory);
      const manifest = join(directory, 'owner-manifest.json');
      await writeFile(manifest, 'keep');
      await rm(manifest);
      await mkdir(manifest);
      await expect(loadOrCreateManifest('isn-dev', 'database-id', root)).rejects.toThrow(/regular file/u);
      await expect(readManifest('isn-dev', 'database-id', root)).rejects.toThrow(/regular file/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
