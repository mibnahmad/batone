import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';

const exec = promisify(execFile);

export interface OcrResult {
  available: boolean;
  text: string;
  engine: string;
}

/**
 * OCR for scanned plans and photographs.
 *
 * Uses a local `tesseract` binary when one is installed. When it is not, the
 * adapter reports `available: false` instead of returning empty text — the
 * pipeline then raises a clarification rather than pretending the plan was
 * blank, which is exactly the behaviour the product rule demands.
 */
@Injectable()
export class OcrAdapter {
  private readonly logger = new Logger(OcrAdapter.name);
  private availability: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    if (this.availability !== null) return this.availability;
    try {
      await exec('tesseract', ['--version']);
      this.availability = true;
    } catch {
      this.logger.warn(
        'Binaire tesseract introuvable : les documents scannés déclencheront une demande de clarification.',
      );
      this.availability = false;
    }
    return this.availability;
  }

  async recognize(buffer: Buffer, extension: string): Promise<OcrResult> {
    if (!(await this.isAvailable())) {
      return { available: false, text: '', engine: 'none' };
    }

    const dir = await mkdtemp(join(tmpdir(), 'batione-ocr-'));
    const input = join(dir, `page${extension}`);
    const outputBase = join(dir, 'out');
    try {
      await writeFile(input, buffer);
      await exec('tesseract', [input, outputBase, '-l', 'fra+eng'], {
        timeout: 120_000,
      });
      const text = await readFile(`${outputBase}.txt`, 'utf8');
      return { available: true, text: text.replace(/\s+/g, ' ').trim(), engine: 'tesseract' };
    } catch (err) {
      this.logger.error(`OCR a échoué : ${String(err)}`);
      return { available: false, text: '', engine: 'tesseract' };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
