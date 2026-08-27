import { Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {
  ConfidenceLevel,
  ExportFormat,
  ServiceId,
  SERVICE_DISCLAIMERS,
  SERVICE_EXPORT_FORMATS,
  SERVICE_LABELS,
  type SourceRef,
} from '@batione/shared';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { AuditService } from '../common/audit.service';
import { TraceabilityService } from '../common/traceability.service';
import { ProjectsService } from '../projects/projects.service';
import { AuthUser } from '../auth/auth.decorators';
import { buildGltf, buildGlb, buildObj } from './gltf-builder';

const CONFIDENCE_LABEL: Record<string, string> = {
  [ConfidenceLevel.CERTAIN]: 'Donnée trouvée',
  [ConfidenceLevel.DEDUCED]: 'Déduite',
  [ConfidenceLevel.HYPOTHESIS]: 'Hypothèse',
  [ConfidenceLevel.USER_CONFIRMED]: 'Confirmée par l’utilisateur',
};

interface Sheet {
  name: string;
  columns: { header: string; key: string; width?: number }[];
  rows: Record<string, unknown>[];
}

/**
 * Exports are part of the traceability guarantee, not a cosmetic feature: every
 * tabular export carries the confidence tier and the source reference of each
 * value, so a printed takeoff can still answer "where does this number come
 * from?" once it leaves the product.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly trace: TraceabilityService,
    private readonly projects: ProjectsService,
  ) {}

  async list(projectId: string, organizationId: string) {
    await this.projects.assertOwned(projectId, organizationId);
    return this.prisma.exportArtifact.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async create(
    projectId: string,
    user: AuthUser,
    service: ServiceId,
    format: ExportFormat,
  ) {
    const project = await this.projects.assertOwned(projectId, user.organizationId);

    if (!SERVICE_EXPORT_FORMATS[service].includes(format)) {
      throw new NotFoundException(
        `Format « ${format} » non disponible pour le service ${SERVICE_LABELS[service]}.`,
      );
    }

    const { buffer, filename } = await this.render(project.id, project.name, service, format);
    const key = this.storage.buildKey(user.organizationId, projectId, `exports/${filename}`);
    const { sizeBytes } = await this.storage.put(key, buffer);

    const artifact = await this.prisma.exportArtifact.create({
      data: {
        projectId,
        service,
        format,
        storageKey: key,
        filename,
        sizeBytes,
        createdBy: user.id,
      },
    });

    await this.audit.record({
      organizationId: user.organizationId,
      projectId,
      actorId: user.id,
      service,
      action: 'export.create',
      entityType: 'ExportArtifact',
      entityId: artifact.id,
      payload: { format, filename },
    });

    return artifact;
  }

  async download(exportId: string, organizationId: string) {
    const artifact = await this.prisma.exportArtifact.findFirst({
      where: { id: exportId, project: { organizationId } },
    });
    if (!artifact) throw new NotFoundException('Export introuvable.');

    return {
      artifact,
      stream: this.storage.stream(artifact.storageKey),
      contentType: contentTypeFor(artifact.format as ExportFormat),
    };
  }

  /* ----------------------------------------------------------------- */

  private async render(
    projectId: string,
    projectName: string,
    service: ServiceId,
    format: ExportFormat,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const slug = slugify(`${projectName}-${service}`);
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === ExportFormat.GLTF || format === ExportFormat.GLB || format === ExportFormat.OBJ) {
      const elements = await this.loadElements(projectId);
      if (elements.length === 0) {
        throw new NotFoundException("Aucun modèle 3D à exporter. Lancez d'abord la génération.");
      }
      if (format === ExportFormat.OBJ) {
        return {
          buffer: Buffer.from(buildObj(elements), 'utf8'),
          filename: `${slug}-${stamp}.obj`,
        };
      }
      if (format === ExportFormat.GLTF) {
        return {
          buffer: Buffer.from(JSON.stringify(buildGltf(elements), null, 2), 'utf8'),
          filename: `${slug}-${stamp}.gltf`,
        };
      }
      return { buffer: buildGlb(elements), filename: `${slug}-${stamp}.glb` };
    }

    const sheets = await this.buildSheets(projectId, service);

    if (format === ExportFormat.XLSX) {
      return {
        buffer: await this.renderXlsx(projectName, service, sheets),
        filename: `${slug}-${stamp}.xlsx`,
      };
    }

    return {
      buffer: await this.renderPdf(projectName, service, sheets),
      filename: `${slug}-${stamp}.pdf`,
    };
  }

  private async loadElements(projectId: string) {
    const model = await this.prisma.model3D.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      include: { elements: true },
    });
    return model?.elements ?? [];
  }

  private async buildSheets(projectId: string, service: ServiceId): Promise<Sheet[]> {
    if (service === ServiceId.TAKEOFF) return this.takeoffSheets(projectId);
    if (service === ServiceId.REBAR) return this.rebarSheets(projectId);
    if (service === ServiceId.PRICE_STUDY) return this.priceSheets(projectId);
    return this.model3dSheets(projectId);
  }

  private async takeoffSheets(projectId: string): Promise<Sheet[]> {
    const lines = await this.prisma.takeoffLine.findMany({
      where: { projectId },
      orderBy: [{ floor: 'asc' }, { category: 'asc' }, { createdAt: 'asc' }],
    });
    const clauses = await this.prisma.cctpClause.findMany({ where: { projectId } });
    const clauseById = new Map(clauses.map((clause) => [clause.id, clause]));

    return [
      {
        name: 'Métré',
        columns: [
          { header: 'Niveau', key: 'floor', width: 12 },
          { header: 'Lot', key: 'category', width: 18 },
          { header: 'Ouvrage', key: 'ouvrage', width: 34 },
          { header: 'Description', key: 'description', width: 40 },
          { header: 'Unité', key: 'unit', width: 8 },
          { header: 'Quantité', key: 'quantity', width: 12 },
          { header: 'Fiabilité', key: 'confidence', width: 24 },
          { header: 'Clause CCTP', key: 'clause', width: 20 },
          { header: 'Source', key: 'source', width: 46 },
          { header: 'Corrections', key: 'corrections', width: 12 },
        ],
        rows: lines.map((line) => ({
          floor: line.floor,
          category: line.category,
          ouvrage: line.ouvrage,
          description: line.description,
          unit: line.unit,
          quantity: line.quantity,
          confidence: CONFIDENCE_LABEL[line.confidence] ?? line.confidence,
          clause:
            line.clauseIds
              .map((id) => clauseById.get(id)?.reference ?? id)
              .join(', ') || '—',
          source: this.describeSources(line.sourceRefs),
          corrections: Array.isArray(line.correctionHistory)
            ? (line.correctionHistory as unknown[]).length
            : 0,
        })),
      },
      {
        name: 'CCTP',
        columns: [
          { header: 'Référence', key: 'reference', width: 14 },
          { header: 'Catégorie', key: 'category', width: 18 },
          { header: 'Texte', key: 'text', width: 80 },
        ],
        rows: clauses.map((clause) => ({
          reference: clause.reference,
          category: clause.category,
          text: clause.text,
        })),
      },
    ];
  }

  private async rebarSheets(projectId: string): Promise<Sheet[]> {
    const elements = await this.prisma.structuralElement.findMany({
      where: { projectId },
      include: { rebarLines: true },
      orderBy: [{ type: 'asc' }, { reference: 'asc' }],
    });

    const detail = elements.flatMap((element) =>
      element.rebarLines.map((line) => ({
        reference: element.reference,
        type: element.type,
        role: line.role,
        diameter: line.diameterMm,
        count: line.count,
        unitLength: line.unitLengthM,
        totalLength: line.totalLengthM,
        totalWeight: line.totalWeightKg,
        computation: line.computation,
        rule: `${line.ruleId}@${line.ruleVersion}`,
        confidence: CONFIDENCE_LABEL[line.confidence] ?? line.confidence,
        source: this.describeSources(line.sourceRefs),
      })),
    );

    const byDiameter = new Map<number, { length: number; weight: number }>();
    for (const line of detail) {
      const bucket = byDiameter.get(line.diameter) ?? { length: 0, weight: 0 };
      bucket.length += line.totalLength;
      bucket.weight += line.totalWeight;
      byDiameter.set(line.diameter, bucket);
    }

    return [
      {
        name: 'Ferraillage',
        columns: [
          { header: 'Élément', key: 'reference', width: 14 },
          { header: 'Type', key: 'type', width: 14 },
          { header: 'Rôle', key: 'role', width: 16 },
          { header: 'Ø (mm)', key: 'diameter', width: 9 },
          { header: 'Nombre', key: 'count', width: 9 },
          { header: 'Long. unitaire (m)', key: 'unitLength', width: 18 },
          { header: 'Long. totale (m)', key: 'totalLength', width: 16 },
          { header: 'Poids (kg)', key: 'totalWeight', width: 12 },
          { header: 'Calcul', key: 'computation', width: 52 },
          { header: 'Règle', key: 'rule', width: 22 },
          { header: 'Fiabilité', key: 'confidence', width: 24 },
          { header: 'Source', key: 'source', width: 40 },
        ],
        rows: detail,
      },
      {
        name: 'Récapitulatif Ø',
        columns: [
          { header: 'Diamètre (mm)', key: 'diameter', width: 16 },
          { header: 'Longueur totale (m)', key: 'length', width: 20 },
          { header: 'Poids total (kg)', key: 'weight', width: 18 },
        ],
        rows: [...byDiameter.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([diameter, bucket]) => ({
            diameter,
            length: round2(bucket.length),
            weight: round2(bucket.weight),
          })),
      },
    ];
  }

  private async priceSheets(projectId: string): Promise<Sheet[]> {
    const study = await this.prisma.priceStudy.findFirst({
      where: { projectId },
      include: { items: { orderBy: { orderIndex: 'asc' } } },
    });
    const items = study?.items ?? [];
    const breakdown = (study?.breakdown ?? null) as Record<string, number> | null;

    return [
      {
        name: 'Étude de prix',
        columns: [
          { header: 'Code', key: 'code', width: 10 },
          { header: 'Désignation', key: 'designation', width: 40 },
          { header: 'Lot', key: 'category', width: 16 },
          { header: 'Unité', key: 'unit', width: 8 },
          { header: 'Quantité', key: 'quantity', width: 12 },
          { header: 'PU matériaux', key: 'unitPriceMaterials', width: 14 },
          { header: 'PU main-d’œuvre', key: 'unitPriceLabour', width: 16 },
          { header: 'PU matériel', key: 'unitPriceEquipment', width: 13 },
          { header: 'Total', key: 'total', width: 14 },
          { header: 'Fiabilité', key: 'confidence', width: 24 },
          { header: 'Source', key: 'source', width: 40 },
        ],
        rows: items.map((item) => ({
          code: item.code,
          designation: item.designation,
          category: item.category,
          unit: item.unit,
          quantity: item.quantity,
          unitPriceMaterials: item.unitPriceMaterials,
          unitPriceLabour: item.unitPriceLabour,
          unitPriceEquipment: item.unitPriceEquipment,
          total: item.total,
          confidence: CONFIDENCE_LABEL[item.confidence] ?? item.confidence,
          source: this.describeSources(item.sourceRefs),
        })),
      },
      {
        name: 'Décomposition',
        columns: [
          { header: 'Poste', key: 'label', width: 32 },
          { header: 'Montant', key: 'value', width: 18 },
        ],
        rows: breakdown
          ? [
              { label: 'Déboursé matériaux', value: breakdown.materials },
              { label: 'Déboursé main-d’œuvre', value: breakdown.labour },
              { label: 'Déboursé matériel', value: breakdown.equipment },
              { label: 'Coût direct', value: breakdown.directCost },
              { label: 'Frais généraux', value: breakdown.overhead },
              { label: 'Marge', value: breakdown.margin },
              { label: 'Total HT', value: breakdown.totalExclVat },
              { label: 'TVA', value: breakdown.vat },
              { label: 'Prix final TTC', value: breakdown.finalPrice },
            ]
          : [],
      },
    ];
  }

  private async model3dSheets(projectId: string): Promise<Sheet[]> {
    const elements = await this.loadElements(projectId);
    return [
      {
        name: 'Éléments 3D',
        columns: [
          { header: 'Identifiant', key: 'externalId', width: 16 },
          { header: 'Type', key: 'type', width: 14 },
          { header: 'Niveau', key: 'floor', width: 12 },
          { header: 'Matériau', key: 'material', width: 20 },
          { header: 'Géométrie', key: 'geometry', width: 60 },
          { header: 'Fiabilité', key: 'confidence', width: 24 },
          { header: 'Source', key: 'source', width: 40 },
        ],
        rows: elements.map((element) => ({
          externalId: element.externalId,
          type: element.type,
          floor: element.floor,
          material: element.material,
          geometry: JSON.stringify(element.geometry),
          confidence: CONFIDENCE_LABEL[element.confidence] ?? element.confidence,
          source: this.describeSources(element.sourceRefs),
        })),
      },
    ];
  }

  private describeSources(raw: unknown): string {
    const refs: SourceRef[] = this.trace.readSourceRefs(raw);
    if (refs.length === 0) return '—';
    return refs
      .map((ref) => {
        const parts: string[] = [];
        if (ref.documentId) parts.push(`doc:${ref.documentId.slice(0, 8)}`);
        if (ref.page) parts.push(`p.${ref.page}`);
        if (ref.clauseId) parts.push(`clause ${ref.clauseId.slice(0, 8)}`);
        if (ref.ruleId) parts.push(`règle ${ref.ruleId}@${ref.ruleVersion ?? '?'}`);
        if (ref.note) parts.push(ref.note);
        if (ref.excerpt) parts.push(`« ${truncate(ref.excerpt, 60)} »`);
        return parts.join(' · ');
      })
      .join(' | ');
  }

  private async renderXlsx(
    projectName: string,
    service: ServiceId,
    sheets: Sheet[],
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BatiOne Construction';
    workbook.created = new Date();

    const cover = workbook.addWorksheet('Informations');
    cover.columns = [{ width: 26 }, { width: 90 }];
    cover.addRows([
      ['Projet', projectName],
      ['Service', SERVICE_LABELS[service]],
      ['Exporté le', new Date().toLocaleString('fr-FR')],
      ['Limites', SERVICE_DISCLAIMERS[service]],
      [
        'Traçabilité',
        'Chaque valeur porte un niveau de fiabilité et une référence de source (document, page, clause ou règle de calcul).',
      ],
    ]);
    cover.getColumn(1).font = { bold: true };
    cover.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

    for (const sheet of sheets) {
      const worksheet = workbook.addWorksheet(sheet.name);
      worksheet.columns = sheet.columns.map((column) => ({
        header: column.header,
        key: column.key,
        width: column.width ?? 18,
      }));
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5A623' },
      };
      for (const row of sheet.rows) worksheet.addRow(row);
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheet.columns.length },
      };
    }

    const output = await workbook.xlsx.writeBuffer();
    return Buffer.from(output);
  }

  private renderPdf(
    projectName: string,
    service: ServiceId,
    sheets: Sheet[],
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).fillColor('#111111').text('BatiOne Construction', { continued: false });
      doc.moveDown(0.2);
      doc.fontSize(14).fillColor('#F5A623').text(SERVICE_LABELS[service]);
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor('#333333').text(`Projet : ${projectName}`);
      doc.text(`Exporté le ${new Date().toLocaleString('fr-FR')}`);
      doc.moveDown(0.5);
      doc.fontSize(8).fillColor('#666666').text(SERVICE_DISCLAIMERS[service], { width: 740 });
      doc.moveDown(0.8);

      const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      for (const sheet of sheets) {
        if (sheet.rows.length === 0) continue;
        doc.addPage();
        doc.fontSize(12).fillColor('#111111').text(sheet.name);
        doc.moveDown(0.4);

        const totalWidth = sheet.columns.reduce((sum, c) => sum + (c.width ?? 18), 0);
        const widths = sheet.columns.map((c) => ((c.width ?? 18) / totalWidth) * usable);

        const writeRow = (values: string[], bold: boolean) => {
          const top = doc.y;
          let height = 0;
          doc.fontSize(7).font(bold ? 'Helvetica-Bold' : 'Helvetica');
          values.forEach((value, index) => {
            const x =
              doc.page.margins.left + widths.slice(0, index).reduce((a, b) => a + b, 0);
            const cellHeight = doc.heightOfString(value, { width: widths[index] - 4 });
            height = Math.max(height, cellHeight);
            doc.text(value, x + 2, top, { width: widths[index] - 4 });
          });
          doc.y = top + height + 4;
          doc
            .moveTo(doc.page.margins.left, doc.y - 2)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y - 2)
            .strokeColor('#DDDDDD')
            .lineWidth(0.4)
            .stroke();
        };

        writeRow(
          sheet.columns.map((column) => column.header),
          true,
        );

        for (const row of sheet.rows) {
          if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
            doc.addPage();
            writeRow(
              sheet.columns.map((column) => column.header),
              true,
            );
          }
          writeRow(
            sheet.columns.map((column) => formatCell(row[column.key])),
            false,
          );
        }
      }

      doc.end();
    });
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return String(round2(value));
  return String(value);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function contentTypeFor(format: ExportFormat): string {
  switch (format) {
    case ExportFormat.XLSX:
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case ExportFormat.PDF:
      return 'application/pdf';
    case ExportFormat.GLB:
      return 'model/gltf-binary';
    case ExportFormat.GLTF:
      return 'model/gltf+json';
    case ExportFormat.OBJ:
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}
