import { basename, dirname, isAbsolute, resolve } from 'node:path';

export function resolveAuthPath(path: string): string {
  if (isAbsolute(path)) return path;
  const workingDirectory = resolve(process.cwd());
  const apiDirectory = basename(workingDirectory) === 'api' && basename(dirname(workingDirectory)) === 'apps'
    ? workingDirectory
    : resolve(workingDirectory, 'apps/api');
  return resolve(apiDirectory, path);
}
