import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const DATASET_VERSION = 1;
const USER_COUNT = 12;
const NAMES = [
  'An Nguyễn', 'Bình Trần', 'Chi Lê', 'Dũng Phạm', 'Giang Võ', 'Hà Đặng',
  'Huy Bùi', 'Lan Đỗ', 'Minh Hồ', 'Ngọc Phan', 'Quân Vũ', 'Thảo Đinh',
];

export interface DemoManifest {
  datasetVersion: number;
  database: string;
  databaseId: string;
  users: Array<{ id: string; email: string; password: string; displayName: string }>;
}

export function manifestPath(root = process.cwd()): string {
  return join(root, '.social-demo-data', 'owner-manifest.json');
}

export function createManifest(database: string, databaseId: string): DemoManifest {
  return {
    datasetVersion: DATASET_VERSION,
    database,
    databaseId,
    users: NAMES.map((displayName, index) => ({
      id: randomUUID(),
      email: `social-demo-${String(index + 1).padStart(2, '0')}@example.test`,
      password: randomBytes(24).toString('base64url'),
      displayName,
    })),
  };
}

export function validateManifest(value: unknown, database: string, databaseId: string): DemoManifest {
  if (!value || typeof value !== 'object') throw new Error('Local owner manifest is invalid');
  const manifest = value as DemoManifest;
  if (manifest.datasetVersion !== DATASET_VERSION || manifest.database !== database ||
      manifest.databaseId !== databaseId ||
      !Array.isArray(manifest.users) || manifest.users.length !== USER_COUNT) {
    throw new Error('Local owner manifest version or database identity is invalid');
  }
  const ids = new Set<string>();
  const emails = new Set<string>();
  for (const [index, user] of manifest.users.entries()) {
    const expectedEmail = `social-demo-${String(index + 1).padStart(2, '0')}@example.test`;
    if (!user || !isUuid(user.id) || user.email !== expectedEmail ||
        typeof user.password !== 'string' || user.password.length < 32 ||
        typeof user.displayName !== 'string' || !user.displayName.trim() ||
        ids.has(user.id) || emails.has(user.email)) {
      throw new Error('Local owner manifest ownership data is invalid');
    }
    ids.add(user.id);
    emails.add(user.email);
  }
  return manifest;
}

export async function loadOrCreateManifest(database: string, databaseId: string): Promise<DemoManifest> {
  const path = manifestPath();
  const directory = join(process.cwd(), '.social-demo-data');
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await assertManifestDirectory(directory);
  try {
    await assertRegularManifest(path);
    return validateManifest(JSON.parse(await readFile(path, 'utf8')), database, databaseId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const manifest = createManifest(database, databaseId);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  await assertManifestDirectory(directory);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporaryPath, 0o600);
    await link(temporaryPath, path);
    return manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      await assertRegularManifest(path);
      return validateManifest(JSON.parse(await readFile(path, 'utf8')), database, databaseId);
    }
    throw error;
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

export async function readManifest(database: string, databaseId: string): Promise<DemoManifest | undefined> {
  try {
    const directory = join(process.cwd(), '.social-demo-data');
    await assertManifestDirectory(directory);
    const path = manifestPath();
    await assertRegularManifest(path);
    return validateManifest(JSON.parse(await readFile(path, 'utf8')), database, databaseId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

async function assertManifestDirectory(directory: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Local owner manifest directory must be a real directory');
  }
}

async function assertRegularManifest(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('Local owner manifest must be a regular file');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
