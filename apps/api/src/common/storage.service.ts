import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Object storage abstraction. The local-disk implementation keeps `npm run dev`
 * dependency-free; swapping in S3 is a matter of replacing this provider since
 * nothing outside it knows where bytes physically live.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('STORAGE_DIR') ?? './.storage');
  }

  /** Deterministic, tenant-scoped key so objects are isolated per organization. */
  buildKey(organizationId: string, projectId: string, filename: string): string {
    const ext = extname(filename).toLowerCase();
    const base = createHash('sha1')
      .update(`${filename}:${randomUUID()}`)
      .digest('hex')
      .slice(0, 24);
    return `${organizationId}/${projectId}/${base}${ext}`;
  }

  private absolute(key: string): string {
    const target = resolve(this.root, key);
    if (!target.startsWith(this.root)) {
      throw new Error('Refusing to resolve a storage key outside the storage root.');
    }
    return target;
  }

  async put(key: string, data: Buffer): Promise<{ key: string; sizeBytes: number }> {
    const path = this.absolute(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return { key, sizeBytes: data.length };
  }

  async putStream(key: string, source: NodeJS.ReadableStream): Promise<string> {
    const path = this.absolute(key);
    await mkdir(dirname(path), { recursive: true });
    await new Promise<void>((res, rej) => {
      const out = createWriteStream(path);
      source.pipe(out);
      out.on('finish', () => res());
      out.on('error', rej);
    });
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.absolute(key));
  }

  stream(key: string): NodeJS.ReadableStream {
    return createReadStream(this.absolute(key));
  }

  async size(key: string): Promise<number> {
    const s = await stat(this.absolute(key));
    return s.size;
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.absolute(key));
    } catch (err) {
      this.logger.warn(`Could not delete storage object ${key}: ${String(err)}`);
    }
  }

  path(key: string): string {
    return join(this.root, key);
  }
}
