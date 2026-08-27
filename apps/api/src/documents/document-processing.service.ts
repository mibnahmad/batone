import { execFile } from 'node:child_process';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../common/prisma.service';
import { parseDxf, type DxfDocument } from './parsers/dxf.parser';
import { extractPdfText } from './parsers/pdf.parser';
import { OcrAdapter } from './parsers/ocr.adapter';

const exec = promisify(execFile);

export interface ParsedDocument {
  format: string;
  pageCount: number;
  /** Flat text used for clause retrieval and dimension mining. */
  text: string;
  pages: { page: number; text: string }[];
  /** Vector geometry when the source was a CAD file. */
  cad?: DxfDocument;
  /** Tabular rows when the source was a spreadsheet. */
  rows?: Record<string, unknown>[];
  /** Set when the document is a scan we could not read. */
  needsOcr: boolean;
  ocrEngine?: string;
  warnings: string[];
}

/**
 * Turns an uploaded file into grounding material for the AI Gateway.
 *
 * The pipeline is deliberately honest about its own limits: whenever it cannot
 * read something it records a warning and sets `needsOcr`, so the service layer
 * can raise a clarification question instead of letting the model hallucinate
 * over an empty document.
 */
@Injectable()
export class DocumentProcessingService {
  private readonly logger = new Logger(DocumentProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: OcrAdapter,
  ) {}

  async process(documentId: string): Promise<ParsedDocument> {
    const document = await this.prisma.projectDocument.findUniqueOrThrow({
      where: { id: documentId },
    });

    await this.prisma.projectDocument.update({
      where: { id: documentId },
      data: { parseStatus: 'parsing', parseError: null },
    });

    try {
      const buffer = await this.storage.get(document.storageKey);
      const parsed = await this.parseBuffer(buffer, document.originalName);
      await this.prisma.projectDocument.update({
        where: { id: documentId },
        data: { parsed: parsed as never, parseStatus: 'parsed' },
      });
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Analyse du document ${documentId} échouée : ${message}`);
      await this.prisma.projectDocument.update({
        where: { id: documentId },
        data: { parseStatus: 'failed', parseError: message },
      });
      throw err;
    }
  }

  async parseBuffer(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    const ext = extname(filename).toLowerCase();
    const warnings: string[] = [];

    switch (ext) {
      case '.dxf':
        return this.parseDxfBuffer(buffer, warnings);
      case '.dwg':
        return this.parseDwgBuffer(buffer, filename, warnings);
      case '.pdf':
        return this.parsePdfBuffer(buffer, warnings);
      case '.jpg':
      case '.jpeg':
      case '.png':
        return this.parseImageBuffer(buffer, ext, warnings);
      case '.xlsx':
        return this.parseXlsxBuffer(buffer, warnings);
      case '.csv':
        return this.parseCsvBuffer(buffer, warnings);
      default:
        warnings.push(`Format ${ext || 'inconnu'} non pris en charge par l'analyseur.`);
        return {
          format: ext.replace('.', '') || 'unknown',
          pageCount: 0,
          text: '',
          pages: [],
          needsOcr: false,
          warnings,
        };
    }
  }

  private parseDxfBuffer(buffer: Buffer, warnings: string[]): ParsedDocument {
    const cad = parseDxf(buffer.toString('utf8'));
    if (cad.entities.length === 0) {
      warnings.push("Aucune entité exploitable trouvée dans le DXF.");
    }
    const text = cad.entities
      .filter((e): e is Extract<typeof e, { type: 'text' }> => e.type === 'text')
      .map((e) => e.value)
      .join('\n');
    return {
      format: 'dxf',
      pageCount: 1,
      text,
      pages: [{ page: 1, text }],
      cad,
      needsOcr: false,
      warnings,
    };
  }

  /**
   * DWG is proprietary and binary. Rather than take a commercial SDK dependency
   * we shell out to an optional converter; without it the document is flagged so
   * the user is told to re-export as DXF instead of silently getting nothing.
   */
  private async parseDwgBuffer(
    buffer: Buffer,
    filename: string,
    warnings: string[],
  ): Promise<ParsedDocument> {
    try {
      await exec('ODAFileConverter', ['--version'], { timeout: 5000 });
    } catch {
      warnings.push(
        "Conversion DWG indisponible sur ce serveur : veuillez fournir un export DXF du même plan.",
      );
      return {
        format: 'dwg',
        pageCount: 0,
        text: '',
        pages: [],
        needsOcr: true,
        warnings,
      };
    }
    // A converter is present; the conversion step itself is deployment-specific.
    warnings.push(`Conversion DWG → DXF requise pour ${filename}.`);
    void buffer;
    return { format: 'dwg', pageCount: 0, text: '', pages: [], needsOcr: true, warnings };
  }

  private async parsePdfBuffer(buffer: Buffer, warnings: string[]): Promise<ParsedDocument> {
    const { pages, needsOcr } = extractPdfText(buffer);
    let resolvedPages = pages;
    let ocrEngine: string | undefined;

    if (needsOcr) {
      const ocrResult = await this.ocr.recognize(buffer, '.pdf');
      if (ocrResult.available && ocrResult.text) {
        resolvedPages = [{ page: 1, text: ocrResult.text }];
        ocrEngine = ocrResult.engine;
      } else {
        warnings.push(
          "Ce PDF ne contient pas de texte extractible (plan scanné) et l'OCR n'est pas disponible.",
        );
      }
    }

    const text = resolvedPages.map((p) => p.text).join('\n');
    return {
      format: 'pdf',
      pageCount: resolvedPages.length,
      text,
      pages: resolvedPages,
      needsOcr: needsOcr && !ocrEngine,
      ocrEngine,
      warnings,
    };
  }

  private async parseImageBuffer(
    buffer: Buffer,
    ext: string,
    warnings: string[],
  ): Promise<ParsedDocument> {
    const ocrResult = await this.ocr.recognize(buffer, ext);
    if (!ocrResult.available) {
      warnings.push("OCR indisponible : le contenu de l'image n'a pas pu être lu.");
    }
    return {
      format: ext.replace('.', ''),
      pageCount: 1,
      text: ocrResult.text,
      pages: [{ page: 1, text: ocrResult.text }],
      needsOcr: !ocrResult.available || ocrResult.text.length === 0,
      ocrEngine: ocrResult.engine,
      warnings,
    };
  }

  private async parseXlsxBuffer(buffer: Buffer, warnings: string[]): Promise<ParsedDocument> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const rows: Record<string, unknown>[] = [];
    const sheet = workbook.worksheets[0];

    if (!sheet) {
      warnings.push('Le classeur ne contient aucune feuille.');
      return {
        format: 'xlsx',
        pageCount: 0,
        text: '',
        pages: [],
        rows,
        needsOcr: false,
        warnings,
      };
    }

    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, col) => {
      headers[col - 1] = String(cell.value ?? `col${col}`).trim();
    });

    sheet.eachRow((row, index) => {
      if (index === 1) return;
      const record: Record<string, unknown> = {};
      row.eachCell((cell, col) => {
        record[headers[col - 1] ?? `col${col}`] = cell.value;
      });
      rows.push(record);
    });

    const text = rows.map((r) => Object.values(r).join(' ')).join('\n');
    return {
      format: 'xlsx',
      pageCount: workbook.worksheets.length,
      text,
      pages: [{ page: 1, text }],
      rows,
      needsOcr: false,
      warnings,
    };
  }

  private parseCsvBuffer(buffer: Buffer, warnings: string[]): ParsedDocument {
    const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) {
      warnings.push('Fichier CSV vide.');
      return {
        format: 'csv',
        pageCount: 0,
        text: '',
        pages: [],
        rows: [],
        needsOcr: false,
        warnings,
      };
    }
    const delimiter = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(delimiter).map((h) => h.trim());
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(delimiter);
      const record: Record<string, unknown> = {};
      headers.forEach((header, i) => {
        record[header] = cells[i]?.trim() ?? '';
      });
      return record;
    });
    const text = lines.join('\n');
    return {
      format: 'csv',
      pageCount: 1,
      text,
      pages: [{ page: 1, text }],
      rows,
      needsOcr: false,
      warnings,
    };
  }
}
