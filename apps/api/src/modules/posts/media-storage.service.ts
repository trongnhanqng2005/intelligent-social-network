import { Injectable } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

@Injectable()
export class MediaStorageService {
  private readonly root = resolve(process.env.MEDIA_STORAGE_PATH ?? join(process.cwd(), 'var', 'uploads'));

  async save(id: string, extension: string, data: Buffer): Promise<string> {
    const path = this.pathFor(id, extension);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx', mode: 0o600 });
    return path;
  }

  async read(id: string, extension: string): Promise<Buffer> {
    return readFile(this.pathFor(id, extension));
  }

  async remove(id: string, extension: string): Promise<void> {
    await unlink(this.pathFor(id, extension));
  }

  extensionFor(originalName: string, mimeType: string): string {
    const extension = extname(originalName).toLowerCase();
    const allowed = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm']);
    if (allowed.has(extension)) return extension;
    if (mimeType === 'image/jpeg') return '.jpg';
    if (mimeType === 'image/png') return '.png';
    if (mimeType === 'image/gif') return '.gif';
    if (mimeType === 'image/webp') return '.webp';
    if (mimeType === 'video/mp4') return '.mp4';
    return '.webm';
  }

  private pathFor(id: string, extension: string): string {
    return join(this.root, `${id}${extension}`);
  }
}
