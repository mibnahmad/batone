import { Injectable, Logger } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';
import {
  ClarificationKind,
  ClarificationRequest,
  ConfidenceLevel,
  Element3DType,
  SourceRef,
  TakeoffUnit,
  TracedValue,
} from '@batione/shared';
import {
  AiChatRequest,
  AiChatResult,
  AiExtractionRequest,
  AiExtractionResult,
  AiProvider,
  AiDocumentContext,
} from './ai-provider.interface';
import { readPlanGeometry, PlanGeometry } from './heuristics/plan-geometry';
import {
  detectFloor,
  findElementReferences,
  findHeights,
  findRebarCallouts,
  findSections,
  findThicknesses,
  splitClauses,
  TextHit,
} from './heuristics/text-mining';
import type { ParsedDocument } from '../documents/document-processing.service';

/**
 * Deterministic, offline extraction engine.
 *
 * This is not a stub: it performs genuine geometry and text extraction from the
 * parsed documents, and — crucially — it observes the same contract as the LLM
 * provider, including refusing to invent values. It is the default provider when
 * no model API key is configured, which keeps local development and the test
 * suite fully reproducible.
 */
interface ChatRow {
  label: string;
  haystack: string;
  valueText: string;
  confidence: string;
  sourceCount: number;
  detail?: string;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function formatFr(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
}

@Injectable()
export class LocalInferenceProvider implements AiProvider {
  readonly name = 'local-deterministic';
  readonly model = 'batione-heuristics-v1';
  private readonly logger = new Logger(LocalInferenceProvider.name);

  async extract<T>(request: AiExtractionRequest<T>): Promise<AiExtractionResult<T>> {
    const clarifications: ClarificationRequest[] = [];
    const notes: string[] = [];
    let raw: unknown[] = [];

    switch (request.task) {
      case 'takeoff.clauses':
        raw = this.extractClauses(request.documents, clarifications);
        break;
      case 'takeoff.lines':
        raw = this.extractTakeoffLines(request.documents, request.context, clarifications);
        break;
      case 'model3d.elements':
        raw = this.extractElements3D(request.documents, request.context, clarifications);
        break;
      case 'rebar.elements':
        raw = this.extractStructuralElements(request.documents, clarifications);
        break;
      default:
        notes.push(`Tâche d'extraction inconnue : ${request.task}`);
    }

    const items: T[] = [];
    for (const candidate of raw) {
      const parsed = request.schema.safeParse(candidate);
      if (parsed.success) {
        items.push(parsed.data);
      } else {
        // A value the engine cannot express in the contract is dropped rather
        // than coerced — silently reshaping data is how bad numbers ship.
        this.logger.warn(
          `Élément rejeté pour ${request.schemaName} : ${parsed.error.issues
            .map((i) => `${i.path.join('.')} ${i.message}`)
            .join('; ')}`,
        );
      }
    }

    return { items, clarifications, notes, provider: this.name, model: this.model };
  }

  async chat<T = unknown>(
    request: AiChatRequest,
    proposalSchema?: ZodType<T, ZodTypeDef, unknown>,
  ): Promise<AiChatResult<T>> {
    const instruction = request.instruction.trim();
    const clarifications: ClarificationRequest[] = [];

    if (request.task === 'model3d.edit') {
      const resolved = this.resolveEditInstruction(instruction, request.context);
      if (!resolved) {
        clarifications.push({
          kind: ClarificationKind.AMBIGUOUS_INSTRUCTION,
          targetPath: 'model3d.instruction',
          question: `Je n'ai pas pu traduire « ${instruction} » en une modification précise. Pouvez-vous préciser l'élément visé et la valeur souhaitée ? Par exemple : « Augmente la hauteur des murs du RDC à 3,20 m ».`,
          options: [],
          sources: [],
        });
        return {
          reply:
            "Je préfère ne pas deviner. Précisez l'élément concerné et la valeur cible pour que j'applique la bonne modification.",
          clarifications,
        };
      }
      const proposal = proposalSchema
        ? proposalSchema.safeParse(resolved.proposal)
        : { success: true as const, data: resolved.proposal as T };
      if (!proposal.success) {
        return { reply: "La modification proposée est invalide.", clarifications };
      }
      return { reply: resolved.reply, proposal: proposal.data as T, clarifications };
    }

    return {
      reply: this.answerFromContext(instruction, request),
      clarifications,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Service 1 — CCTP clauses                                          */
  /* ---------------------------------------------------------------- */

  private extractClauses(
    documents: AiDocumentContext[],
    clarifications: ClarificationRequest[],
  ): unknown[] {
    const cctp = documents.filter((d) => d.kind === 'cctp');
    if (cctp.length === 0) {
      clarifications.push({
        kind: ClarificationKind.MISSING_DATA,
        targetPath: 'project.cctp',
        question:
          "Aucun cahier des charges (CCTP) n'a été fourni. Le métré ne peut pas être justifié sans lui. Souhaitez-vous en importer un maintenant ?",
        options: ['Importer un CCTP', 'Poursuivre sans justification contractuelle'],
        sources: [],
      });
      return [];
    }

    const out: unknown[] = [];
    for (const doc of cctp) {
      if (!doc.text.trim()) {
        clarifications.push({
          kind: ClarificationKind.MISSING_DATA,
          targetPath: `document:${doc.id}.text`,
          question: `Le document « ${doc.name} » ne contient aucun texte exploitable (document scanné ?). Pouvez-vous fournir une version texte ou activer l'OCR ?`,
          options: [],
          sources: [{ documentId: doc.id, page: 1 }],
        });
        continue;
      }
      for (const clause of splitClauses(doc.text)) {
        out.push({
          reference: clause.reference,
          title: clause.title,
          text: clause.text,
          extractedRule: this.distillRule(clause.text),
          category: this.categorize(`${clause.title} ${clause.text}`),
          page: this.pageOf(doc, clause.index),
        });
      }
    }
    return out;
  }

  /** Pulls a machine-usable statement out of a clause when one is stated plainly. */
  private distillRule(text: string): string | undefined {
    const thickness = findThicknesses(text)[0];
    const height = findHeights(text)[0];
    const parts: string[] = [];
    if (thickness) parts.push(`épaisseur = ${thickness.value} m`);
    if (height) parts.push(`hauteur = ${height.value} m`);
    return parts.length > 0 ? parts.join(' ; ') : undefined;
  }

  private categorize(text: string): string {
    const rules: [RegExp, string][] = [
      [/(gros[- ]?œuvre|maçonnerie|maconnerie|béton|beton|fondation)/i, 'gros_oeuvre'],
      [/(charpente|couverture|toiture)/i, 'couverture'],
      [/(menuiserie|porte|fenêtre|fenetre)/i, 'menuiseries'],
      [/(plomberie|sanitaire|cvc|chauffage|ventilation)/i, 'fluides'],
      [/(électric|electric|courant fort|courant faible)/i, 'electricite'],
      [/(peinture|revêtement|revetement|carrelage|finition)/i, 'finitions'],
      [/(vrd|terrassement|voirie|réseau|reseau)/i, 'vrd'],
    ];
    for (const [pattern, category] of rules) {
      if (pattern.test(text)) return category;
    }
    return 'divers';
  }

  /* ---------------------------------------------------------------- */
  /* Service 1 — Takeoff lines                                         */
  /* ---------------------------------------------------------------- */

  private extractTakeoffLines(
    documents: AiDocumentContext[],
    context: Record<string, unknown> | undefined,
    clarifications: ClarificationRequest[],
  ): unknown[] {
    // Quantities are measured on floor plans. Sections (coupes) describe
    // structure, not floor areas: counting them as a storey would invent a level.
    const plans = documents.filter((d) => d.kind === 'plan');
    if (plans.length === 0) {
      clarifications.push({
        kind: ClarificationKind.MISSING_DATA,
        targetPath: 'project.plans',
        question: "Aucun plan n'a été importé. Importez au moins un plan pour lancer le métré.",
        options: [],
        sources: [],
      });
      return [];
    }

    const clauseIndex = (context?.clauses as { id: string; category: string }[]) ?? [];
    const lines: unknown[] = [];

    for (const doc of plans) {
      const parsed = this.parsedOf(doc);
      const floor = detectFloor(doc.floor, doc.name, doc.text) ?? 'RDC';
      const geometry = parsed?.cad ? readPlanGeometry(parsed.cad) : null;
      const sourceBase: SourceRef = { documentId: doc.id, page: 1 };

      if (!geometry || geometry.walls.length === 0) {
        if (!doc.text.trim()) {
          clarifications.push({
            kind: ClarificationKind.MISSING_DATA,
            targetPath: `document:${doc.id}.geometry`,
            question: `Le plan « ${doc.name} » n'est pas exploitable automatiquement (ni géométrie vectorielle, ni texte). Pouvez-vous fournir un DXF ou un PDF vectoriel ?`,
            options: [],
            sources: [sourceBase],
          });
          continue;
        }
      }

      const height = this.resolveHeight(doc, documents, clarifications, floor);
      const thickness = this.resolveThickness(doc, documents, clarifications, floor);

      if (geometry && geometry.totalWallLengthM > 0) {
        const netLength = geometry.totalWallLengthM;
        lines.push(
          this.takeoffLine({
            ouvrage: 'Murs — maçonnerie',
            description: `Élévation de murs, épaisseur ${thickness.value.toFixed(2)} m, hauteur ${height.value.toFixed(2)} m`,
            category: 'gros_oeuvre',
            unit: TakeoffUnit.M2,
            floor,
            quantity: round2(netLength * height.value),
            confidence: weakest([height.confidence, thickness.confidence, ConfidenceLevel.CERTAIN]),
            sources: dedupe([
              sourceBase,
              ...height.sources,
              ...thickness.sources,
              { documentId: doc.id, page: 1, note: `Linéaire de murs relevé : ${netLength.toFixed(2)} m` },
            ]),
            dimensions: [
              tracedDim('linéaire de murs', netLength, ConfidenceLevel.CERTAIN, [sourceBase]),
              tracedDim('hauteur', height.value, height.confidence, height.sources),
              tracedDim('épaisseur', thickness.value, thickness.confidence, thickness.sources),
            ],
            clauseIds: matchClauses(clauseIndex, 'gros_oeuvre'),
          }),
        );

        lines.push(
          this.takeoffLine({
            ouvrage: 'Murs — volume de matériau',
            description: 'Volume de maçonnerie hors ouvertures',
            category: 'gros_oeuvre',
            unit: TakeoffUnit.M3,
            floor,
            quantity: round2(netLength * height.value * thickness.value),
            confidence: weakest([height.confidence, thickness.confidence]),
            sources: dedupe([sourceBase, ...height.sources, ...thickness.sources]),
            dimensions: [
              tracedDim('linéaire de murs', netLength, ConfidenceLevel.CERTAIN, [sourceBase]),
              tracedDim('hauteur', height.value, height.confidence, height.sources),
              tracedDim('épaisseur', thickness.value, thickness.confidence, thickness.sources),
            ],
            clauseIds: matchClauses(clauseIndex, 'gros_oeuvre'),
          }),
        );
      }

      if (geometry && geometry.totalSlabAreaM2 > 0) {
        lines.push(
          this.takeoffLine({
            ouvrage: 'Dalle / plancher',
            description: 'Surface de plancher relevée sur le plan',
            category: 'gros_oeuvre',
            unit: TakeoffUnit.M2,
            floor,
            quantity: round2(geometry.totalSlabAreaM2),
            confidence: ConfidenceLevel.CERTAIN,
            sources: [sourceBase],
            dimensions: [
              tracedDim('surface', geometry.totalSlabAreaM2, ConfidenceLevel.CERTAIN, [sourceBase]),
            ],
            clauseIds: matchClauses(clauseIndex, 'gros_oeuvre'),
          }),
        );
      }

      if (geometry && geometry.openings > 0) {
        lines.push(
          this.takeoffLine({
            ouvrage: 'Menuiseries — ouvertures',
            description: 'Portes et fenêtres repérées sur le plan',
            category: 'menuiseries',
            unit: TakeoffUnit.U,
            floor,
            quantity: geometry.openings,
            confidence: ConfidenceLevel.DEDUCED,
            sources: [sourceBase],
            dimensions: [],
            clauseIds: matchClauses(clauseIndex, 'menuiseries'),
          }),
        );
      }

      if (geometry && geometry.columns > 0) {
        lines.push(
          this.takeoffLine({
            ouvrage: 'Poteaux',
            description: 'Poteaux repérés sur le plan',
            category: 'gros_oeuvre',
            unit: TakeoffUnit.U,
            floor,
            quantity: geometry.columns,
            confidence: ConfidenceLevel.DEDUCED,
            sources: [sourceBase],
            dimensions: [],
            clauseIds: matchClauses(clauseIndex, 'gros_oeuvre'),
          }),
        );
      }
    }

    return lines;
  }

  private takeoffLine(input: {
    ouvrage: string;
    description: string;
    category: string;
    unit: string;
    floor: string;
    quantity: number;
    confidence: ConfidenceLevel;
    sources: SourceRef[];
    dimensions: unknown[];
    clauseIds: string[];
  }) {
    return {
      ouvrage: input.ouvrage,
      description: input.description,
      category: input.category,
      unit: input.unit,
      floor: input.floor,
      quantity: {
        value: input.quantity,
        confidence: input.confidence,
        sources: input.sources,
      },
      dimensions: input.dimensions,
      cctpClauseIds: input.clauseIds,
      sources: input.sources,
      confidence: input.confidence,
    };
  }

  /**
   * Storey height: read it if stated, otherwise raise a question and fall back to
   * a clearly-labelled hypothesis rather than a silent default.
   */
  private resolveHeight(
    doc: AiDocumentContext,
    documents: AiDocumentContext[],
    clarifications: ClarificationRequest[],
    floor: string,
  ): TracedValue<number> {
    const found = this.searchAcross(documents, doc, findHeights);
    if (found.length === 0) {
      clarifications.push({
        kind: ClarificationKind.MISSING_DATA,
        targetPath: `takeoff.${floor}.wallHeight`,
        question: `La hauteur sous plafond du niveau ${floor} n'est indiquée ni sur les plans ni dans le CCTP. Quelle hauteur retenir ?`,
        options: ['2,50 m', '2,70 m', '3,00 m'],
        sources: [{ documentId: doc.id, page: 1 }],
      });
      return {
        value: 2.5,
        confidence: ConfidenceLevel.HYPOTHESIS,
        sources: [],
        reasoning:
          "Hauteur non trouvée dans les documents ; valeur d'attente en attendant confirmation.",
      };
    }

    const distinct = [...new Set(found.map((h) => h.hit.value))];
    if (distinct.length > 1) {
      clarifications.push({
        kind: ClarificationKind.CONTRADICTION,
        targetPath: `takeoff.${floor}.wallHeight`,
        question: `Les documents indiquent des hauteurs contradictoires pour le niveau ${floor} : ${distinct
          .map((v) => `${v} m`)
          .join(' / ')}. Laquelle fait foi ?`,
        options: distinct.map((v) => `${v} m`),
        sources: found.map((f) => f.source),
      });
      return {
        value: distinct[0],
        confidence: ConfidenceLevel.HYPOTHESIS,
        sources: found.map((f) => f.source),
        reasoning: 'Valeurs contradictoires détectées ; en attente d\'arbitrage.',
      };
    }

    return {
      value: distinct[0],
      confidence: ConfidenceLevel.CERTAIN,
      sources: found.map((f) => f.source),
    };
  }

  private resolveThickness(
    doc: AiDocumentContext,
    documents: AiDocumentContext[],
    clarifications: ClarificationRequest[],
    floor: string,
  ): TracedValue<number> {
    const found = this.searchAcross(documents, doc, findThicknesses);
    if (found.length === 0) {
      clarifications.push({
        kind: ClarificationKind.MISSING_DATA,
        targetPath: `takeoff.${floor}.wallThickness`,
        question: `L'épaisseur des murs du niveau ${floor} n'est pas précisée. Quelle épaisseur retenir ?`,
        options: ['0,20 m', '0,25 m', '0,30 m'],
        sources: [{ documentId: doc.id, page: 1 }],
      });
      return {
        value: 0.2,
        confidence: ConfidenceLevel.HYPOTHESIS,
        sources: [],
        reasoning: 'Épaisseur non trouvée dans les documents.',
      };
    }
    const distinct = [...new Set(found.map((f) => f.hit.value))];
    if (distinct.length > 1) {
      clarifications.push({
        kind: ClarificationKind.CONTRADICTION,
        targetPath: `takeoff.${floor}.wallThickness`,
        question: `Épaisseurs de mur contradictoires pour le niveau ${floor} : ${distinct
          .map((v) => `${v} m`)
          .join(' / ')}. Laquelle retenir ?`,
        options: distinct.map((v) => `${v} m`),
        sources: found.map((f) => f.source),
      });
      return {
        value: distinct[0],
        confidence: ConfidenceLevel.HYPOTHESIS,
        sources: found.map((f) => f.source),
      };
    }
    return {
      value: distinct[0],
      confidence: ConfidenceLevel.CERTAIN,
      sources: found.map((f) => f.source),
    };
  }

  /** Runs a text miner over the plan itself first, then over the CCTP. */
  private searchAcross<T>(
    documents: AiDocumentContext[],
    preferred: AiDocumentContext,
    miner: (text: string) => TextHit<T>[],
  ): { hit: TextHit<T>; source: SourceRef }[] {
    const order = [preferred, ...documents.filter((d) => d.id !== preferred.id)];
    const results: { hit: TextHit<T>; source: SourceRef }[] = [];
    for (const doc of order) {
      for (const hit of miner(doc.text)) {
        results.push({
          hit,
          source: {
            documentId: doc.id,
            page: this.pageOf(doc, hit.index),
            excerpt: hit.excerpt,
          },
        });
      }
      if (results.length > 0) break;
    }
    return results;
  }

  /* ---------------------------------------------------------------- */
  /* Service 2 — 3D elements                                           */
  /* ---------------------------------------------------------------- */

  private extractElements3D(
    documents: AiDocumentContext[],
    context: Record<string, unknown> | undefined,
    clarifications: ClarificationRequest[],
  ): unknown[] {
    const plans = documents.filter((d) => d.kind === 'plan');
    if (plans.length === 0) {
      clarifications.push({
        kind: ClarificationKind.MISSING_DATA,
        targetPath: 'model3d.plans',
        question: "Aucun plan de niveau n'a été importé. Importez au moins un plan par étage.",
        options: [],
        sources: [],
      });
      return [];
    }

    const elements: unknown[] = [];
    let elevation = 0;

    const ordered = [...plans].sort((a, b) => floorRank(a) - floorRank(b));

    for (const doc of ordered) {
      const parsed = this.parsedOf(doc);
      const floor = detectFloor(doc.floor, doc.name, doc.text) ?? 'RDC';
      const source: SourceRef = { documentId: doc.id, page: 1 };
      const height = this.resolveHeight(doc, documents, clarifications, floor);
      const thickness = this.resolveThickness(doc, documents, clarifications, floor);

      const geometry: PlanGeometry | null = parsed?.cad ? readPlanGeometry(parsed.cad) : null;
      if (!geometry || geometry.walls.length === 0) {
        clarifications.push({
          kind: ClarificationKind.MISSING_DATA,
          targetPath: `model3d.${floor}.geometry`,
          question: `Le plan « ${doc.name} » ne fournit pas de géométrie vectorielle exploitable pour générer le niveau ${floor}. Pouvez-vous fournir un DXF ?`,
          options: [],
          sources: [source],
        });
        continue;
      }

      const origin = geometry.bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };

      geometry.walls.forEach((wall, index) => {
        const midX = (wall.start.x + wall.end.x) / 2 - origin.minX;
        const midY = (wall.start.y + wall.end.y) / 2 - origin.minY;
        const rotationY = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
        elements.push({
          externalId: `${slug(floor)}-wall-${index + 1}`,
          type: Element3DType.WALL,
          name: `Mur ${index + 1}`,
          floor,
          geometry: {
            kind: 'box',
            position: [round3(midX), round3(elevation + height.value / 2), round3(midY)],
            size: [round3(wall.lengthM), round3(height.value), round3(thickness.value)],
            rotationY: round3(-rotationY),
          },
          material: 'beton',
          attributes: {
            lengthM: round3(wall.lengthM),
            heightM: round3(height.value),
            thicknessM: round3(thickness.value),
            layer: wall.layer,
          },
          sources: dedupe([source, ...height.sources, ...thickness.sources]),
          confidence: weakest([height.confidence, thickness.confidence]),
        });
      });

      geometry.slabs.forEach((slab, index) => {
        const width = origin.maxX - origin.minX || Math.sqrt(slab.areaM2);
        const depth = origin.maxY - origin.minY || Math.sqrt(slab.areaM2);
        elements.push({
          externalId: `${slug(floor)}-slab-${index + 1}`,
          type: Element3DType.SLAB,
          name: `Dalle ${floor}`,
          floor,
          geometry: {
            kind: 'box',
            position: [round3(width / 2), round3(elevation - 0.1), round3(depth / 2)],
            size: [round3(width), 0.2, round3(depth)],
            rotationY: 0,
          },
          material: 'beton_arme',
          attributes: { areaM2: round3(slab.areaM2), perimeterM: round3(slab.perimeterM) },
          sources: [source],
          confidence: ConfidenceLevel.CERTAIN,
        });
      });

      elevation += height.value + 0.2;
    }

    void context;
    return elements;
  }

  /* ---------------------------------------------------------------- */
  /* Service 3 — Structural elements                                   */
  /* ---------------------------------------------------------------- */

  private extractStructuralElements(
    documents: AiDocumentContext[],
    clarifications: ClarificationRequest[],
  ): unknown[] {
    // Structural sections are authoritative for rebar. Architectural plans are
    // only a fallback: a door labelled "P1" on a plan must never be mistaken
    // for the column "P1" of the structural drawing.
    const coupes = documents.filter((d) => d.kind === 'coupe');
    const sections = coupes.length > 0 ? coupes : documents.filter((d) => d.kind === 'plan');
    if (sections.length === 0) {
      clarifications.push({
        kind: ClarificationKind.MISSING_DATA,
        targetPath: 'rebar.sections',
        question:
          "Aucune coupe ni plan de structure n'a été importé. Le métré ferraillage nécessite les coupes des éléments (semelles, poteaux, poutres…).",
        options: [],
        sources: [],
      });
      return [];
    }

    const out: unknown[] = [];
    const seenRefs = new Set<string>();

    for (const doc of sections) {
      const text = doc.text;
      if (!text.trim()) {
        clarifications.push({
          kind: ClarificationKind.MISSING_DATA,
          targetPath: `document:${doc.id}.callouts`,
          question: `Aucune annotation lisible dans « ${doc.name} ». Les cartouches d'armatures (ex. « 4HA12 ») sont nécessaires pour calculer le ferraillage.`,
          options: [],
          sources: [{ documentId: doc.id, page: 1 }],
        });
        continue;
      }

      const source: SourceRef = { documentId: doc.id, page: 1 };

      // Structural call-outs are written one element per annotation line
      // ("PT1 poutre 25x50 - 6HA14 - cadres HA8 e=15 - L=5,00"). Scoping the
      // read to the line prevents a neighbouring element's bars from being
      // attributed to this one, which is the classic silent takeoff error.
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      let foundAny = false;

      for (const line of lines) {
        if (ARCHITECTURAL_LINE.test(line)) continue;

        const refsOnLine = findElementReferences(line);
        if (refsOnLine.length === 0) continue;

        const ref = refsOnLine[0];
        if (seenRefs.has(ref.value)) continue;
        seenRefs.add(ref.value);
        foundAny = true;

        const type = structuralTypeFor(ref.value, line);
        const section = findSections(line)[0];
        const callouts = findRebarCallouts(line);

        const dimensions: Record<string, unknown> = {};
        if (section) {
          dimensions.width = tracedValue(section.value.a, ConfidenceLevel.CERTAIN, [
            { ...source, excerpt: line },
          ]);
          dimensions.height = tracedValue(section.value.b, ConfidenceLevel.CERTAIN, [
            { ...source, excerpt: line },
          ]);
        } else {
          clarifications.push({
            kind: ClarificationKind.MISSING_DATA,
            targetPath: `rebar.${ref.value}.section`,
            question: `La section de l'élément ${ref.value} n'est pas lisible sur la coupe. Quelle section retenir (ex. 20x40 cm) ?`,
            options: [],
            sources: [source],
          });
        }

        const lengthHit =
          /(?:longueur|\bL)\s*[:=]\s*(\d+(?:[.,]\d+)?)/i.exec(line);
        if (lengthHit) {
          dimensions.length = tracedValue(
            Number.parseFloat(lengthHit[1].replace(',', '.')),
            ConfidenceLevel.CERTAIN,
            [{ ...source, excerpt: line }],
          );
        } else {
          clarifications.push({
            kind: ClarificationKind.MISSING_DATA,
            targetPath: `rebar.${ref.value}.length`,
            question: `La longueur de l'élément ${ref.value} n'est pas indiquée. Quelle longueur retenir (en m) ?`,
            options: [],
            sources: [source],
          });
        }

        if (callouts.length === 0) {
          clarifications.push({
            kind: ClarificationKind.MISSING_DATA,
            targetPath: `rebar.${ref.value}.callouts`,
            question: `Aucun cartouche d'armature n'est lisible pour ${ref.value}. Quelles armatures retenir (ex. « 4HA12, cadres HA8 e=20 ») ?`,
            options: [],
            sources: [source],
          });
        }

        out.push({
          reference: ref.value,
          type,
          floor: detectFloor(doc.floor, doc.name) ?? 'Fondations',
          count: 1,
          dimensions,
          callouts: callouts.map((c) => ({
            raw: tracedValue(c.raw, ConfidenceLevel.CERTAIN, [
              { ...source, excerpt: line },
            ]),
            // "cadres HA8 e=20" — the word that makes a bar a stirrup sits
            // before the call-out, so the preceding text decides the role.
            role:
              c.value.spacingM !== undefined ||
              /(cadre|cadres|cad\.|étrier|etrier|epingle|épingle)[^A-Za-z0-9]{0,12}$/i.test(
                line.slice(0, c.index),
              )
                ? 'transversal'
                : 'longitudinal',
            diameterMm: tracedValue(c.value.diameterMm, ConfidenceLevel.CERTAIN, [
              { ...source, excerpt: line },
            ]),
            ...(c.value.count !== undefined
              ? {
                  count: tracedValue(c.value.count, ConfidenceLevel.CERTAIN, [
                    { ...source, excerpt: line },
                  ]),
                }
              : {}),
            ...(c.value.spacingM !== undefined
              ? {
                  spacingM: tracedValue(c.value.spacingM, ConfidenceLevel.CERTAIN, [
                    { ...source, excerpt: line },
                  ]),
                }
              : {}),
          })),
          sources: [source],
          confidence:
            Object.keys(dimensions).length > 0 && callouts.length > 0
              ? ConfidenceLevel.CERTAIN
              : ConfidenceLevel.HYPOTHESIS,
        });
      }

      if (!foundAny) {
        clarifications.push({
          kind: ClarificationKind.MISSING_DATA,
          targetPath: `document:${doc.id}.references`,
          question: `Aucun repère d'élément structurel (S1, P2, …) n'a été trouvé dans « ${doc.name} ». Pouvez-vous préciser les éléments à métrer ?`,
          options: [],
          sources: [source],
        });
      }
    }

    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Chat                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Resolves French natural-language edit instructions into structured
   * operations. Anything outside this grammar returns null so the caller asks a
   * question instead of applying a guess.
   */
  private resolveEditInstruction(
    instruction: string,
    context: Record<string, unknown> | undefined,
  ): { proposal: unknown; reply: string } | null {
    const floors = (context?.floors as string[]) ?? [];
    const normalized = instruction.toLowerCase();

    const targetFloors = floors.filter((floor) =>
      normalized.includes(floor.toLowerCase()) ||
      (floor === 'RDC' && /rez[- ]de[- ]chauss/i.test(instruction)),
    );

    const heightMatch =
      /(?:hauteur|hauteurs)[^0-9]{0,40}?(\d+(?:[.,]\d+)?)\s*m/i.exec(instruction);
    if (heightMatch && /mur/i.test(instruction)) {
      const value = Number.parseFloat(heightMatch[1].replace(',', '.'));
      return {
        proposal: {
          instruction,
          operations: [
            {
              op: 'set_property',
              selector: { types: ['wall'], floors: targetFloors, externalIds: [] },
              property: 'height',
              value,
            },
          ],
          summary: `Passer la hauteur des murs${
            targetFloors.length ? ` du niveau ${targetFloors.join(', ')}` : ''
          } à ${value.toFixed(2)} m`,
          affectedCount: 0,
          diff: [],
        },
        reply: `Je peux passer la hauteur des murs${
          targetFloors.length ? ` du niveau ${targetFloors.join(', ')}` : ''
        } à ${value.toFixed(2)} m. Souhaitez-vous appliquer cette modification ?`,
      };
    }

    const materialMatch =
      /(?:matériau|materiau|matiere|matière)[^a-zà-ÿ]{0,10}(?:en|:|=)?\s*([a-zà-ÿ_]+)/i.exec(
        instruction,
      ) ?? /(?:changer?|passe[rz]?)\s+(?:le\s+)?matériau\s+en\s+([a-zà-ÿ_]+)/i.exec(instruction);
    if (materialMatch) {
      const material = materialMatch[1].toLowerCase();
      return {
        proposal: {
          instruction,
          operations: [
            {
              op: 'set_property',
              selector: {
                types: detectTypes(normalized),
                floors: targetFloors,
                externalIds: [],
              },
              property: 'material',
              value: material,
            },
          ],
          summary: `Changer le matériau en « ${material} »`,
          affectedCount: 0,
          diff: [],
        },
        reply: `Je peux changer le matériau des éléments sélectionnés en « ${material} ». Appliquer ?`,
      };
    }

    if (/(montre|affiche|isole|seulement|uniquement)/i.test(instruction) && targetFloors.length) {
      return {
        proposal: {
          instruction,
          operations: [
            {
              op: 'set_visibility',
              selector: { types: [], floors: floors.filter((f) => !targetFloors.includes(f)), externalIds: [] },
              visible: false,
            },
            {
              op: 'set_visibility',
              selector: { types: [], floors: targetFloors, externalIds: [] },
              visible: true,
            },
          ],
          summary: `N'afficher que le niveau ${targetFloors.join(', ')}`,
          affectedCount: 0,
          diff: [],
        },
        reply: `J'isole le niveau ${targetFloors.join(', ')} dans la vue 3D. Appliquer ?`,
      };
    }

    if (/(supprime|enlève|enleve|retire)/i.test(instruction)) {
      const ids = (context?.selectedIds as string[]) ?? [];
      if (ids.length === 0) return null;
      return {
        proposal: {
          instruction,
          operations: [{ op: 'remove_element', externalIds: ids }],
          summary: `Supprimer ${ids.length} élément(s)`,
          affectedCount: ids.length,
          diff: [],
        },
        reply: `Je peux supprimer ${ids.length} élément(s) sélectionné(s). Appliquer ?`,
      };
    }

    return null;
  }

  /** Answers questions strictly from what is already in the project state. */
  /**
   * Grounded answering for the table-based services. Every sentence produced
   * here is a projection of rows that already exist in the database — the
   * assistant never introduces a technical value of its own.
   */
  private answerFromContext(instruction: string, request: AiChatRequest): string {
    const state = (request.context ?? {}) as Record<string, unknown>;
    const q = normalizeText(instruction);
    const open = Number(state.openClarifications ?? 0);

    if (/incoherence|contradiction|probleme|bloqu/.test(q)) {
      return open > 0
        ? `${open} point(s) de clarification sont ouverts sur ce service. Répondez-y dans le panneau « Clarifications » : les lignes concernées restent bloquées tant qu'une valeur n'est pas confirmée.`
        : "Aucune incohérence ouverte : toutes les valeurs affichées sont soit lues dans un document, soit déduites d'une règle, soit confirmées par un utilisateur.";
    }

    const rows = this.chatRows(state);

    if (/hypothes|suppos|assum/.test(q)) {
      const assumed = rows.filter((r) => r.confidence === 'hypothesis' || r.confidence === 'deduced');
      if (assumed.length === 0) {
        return 'Aucune hypothèse : toutes les valeurs sont soit lues dans un document, soit confirmées.';
      }
      return [
        `${assumed.length} valeur(s) ne sont pas lues directement dans un document :`,
        ...assumed.slice(0, 12).map((r) => `• ${r.label} — ${r.valueText} (${r.confidence === 'hypothesis' ? 'hypothèse' : 'déduit d\'une règle'})`),
      ].join('\n');
    }

    if (/total|somme|montant|recalcul|poids/.test(q)) {
      return this.chatTotals(state, rows);
    }

    const match = this.bestChatRow(rows, q);
    if (match) {
      const parts = [`${match.label} : ${match.valueText}.`];
      parts.push(
        match.confidence === 'certain'
          ? `Valeur lue dans les documents du projet (${match.sourceCount} source(s) liée(s)).`
          : match.confidence === 'user_confirmed'
            ? 'Valeur confirmée manuellement ; la valeur initiale est conservée dans l\'historique.'
            : match.confidence === 'deduced'
              ? 'Valeur déduite d\'une règle BatiOne, pas lue telle quelle dans un document.'
              : 'Valeur posée en hypothèse : elle doit être confirmée avant usage contractuel.',
      );
      if (match.detail) parts.push(match.detail);
      parts.push('Sélectionnez la ligne dans le tableau pour ouvrir le détail des sources.');
      return parts.join(' ');
    }

    if (rows.length === 0) {
      return request.documents.length === 0
        ? "Aucun document n'est encore rattaché à ce projet. Importez vos plans et le cahier des charges pour que je puisse répondre en m'appuyant sur des sources."
        : "Le service n'a pas encore été exécuté sur ce projet : lancez l'analyse pour que je puisse répondre à partir de résultats sourcés.";
    }

    return `${this.chatTotals(state, rows)}\n\nPrécisez un ouvrage, un niveau ou une référence (par exemple « murs du RDC ») pour que je détaille l'origine de la valeur.`;
  }

  /** Normalises the three services' state into a single answerable row shape. */
  private chatRows(state: Record<string, unknown>): ChatRow[] {
    const lines = state.lines as Record<string, unknown>[] | undefined;
    if (Array.isArray(lines)) {
      return lines.map((l) => ({
        label: `${String(l.ouvrage)} — ${String(l.floor)}`,
        haystack: normalizeText(
          `${l.ouvrage} ${l.description ?? ''} ${l.category ?? ''} ${l.floor}`,
        ),
        valueText: `${formatFr(Number(l.quantity))} ${String(l.unit)}`,
        confidence: String(l.confidence),
        sourceCount: Number(l.sourceCount ?? 0),
        detail:
          Number(l.clauseCount ?? 0) > 0
            ? `${l.clauseCount} clause(s) du CCTP justifient cette ligne.`
            : undefined,
      }));
    }

    const elements = state.elements as Record<string, unknown>[] | undefined;
    if (Array.isArray(elements)) {
      return elements.map((e) => {
        const bars = (e.lines as Record<string, unknown>[] | undefined) ?? [];
        return {
          label: `${String(e.reference)} (${String(e.type)})`,
          haystack: normalizeText(`${e.reference} ${e.type} ${e.floor ?? ''}`),
          valueText: `${formatFr(Number(e.weightKg ?? 0))} kg d'acier`,
          confidence: String(bars[0]?.confidence ?? 'certain'),
          sourceCount: 1,
          detail: bars
            .map(
              (b) =>
                `${b.role === 'transversal' ? 'Cadres' : 'Filants'} HA${b.diameterMm} : ${b.computation}`,
            )
            .join(' | '),
        };
      });
    }

    const items = state.items as Record<string, unknown>[] | undefined;
    if (Array.isArray(items)) {
      return items.map((i) => ({
        label: String(i.designation),
        haystack: normalizeText(`${i.designation} ${i.category ?? ''}`),
        valueText: `${formatFr(Number(i.total ?? 0))} ${String(state.currency ?? 'EUR')}`,
        confidence: String(i.confidence),
        sourceCount: 1,
        detail: `${formatFr(Number(i.quantity))} ${String(i.unit)} × (matériaux ${formatFr(
          Number(i.unitPriceMaterials ?? 0),
        )} + main d'œuvre ${formatFr(Number(i.unitPriceLabour ?? 0))} + matériel ${formatFr(
          Number(i.unitPriceEquipment ?? 0),
        )}).`,
      }));
    }
    return [];
  }

  private bestChatRow(rows: ChatRow[], query: string): ChatRow | null {
    const words = query.split(/[^a-z0-9+]+/).filter((w) => w.length > 2);
    let best: ChatRow | null = null;
    let bestScore = 0;
    for (const row of rows) {
      let score = 0;
      for (const word of words) if (row.haystack.includes(word)) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }
    return bestScore >= 2 ? best : null;
  }

  private chatTotals(state: Record<string, unknown>, rows: ChatRow[]): string {
    if (state.breakdown && typeof state.breakdown === 'object') {
      const breakdown = state.breakdown as { steps?: { label: string; amount: number }[] };
      const steps = breakdown.steps ?? [];
      return [
        `Étude de prix — ${Number(state.itemCount ?? 0)} poste(s) :`,
        ...steps.map((s) => `• ${s.label} : ${formatFr(s.amount)} ${String(state.currency ?? 'EUR')}`),
      ].join('\n');
    }
    if (state.totalWeight !== undefined) {
      return `Ferraillage : ${formatFr(Math.round(Number(state.totalWeight) * 1000) / 1000)} kg d'acier au total sur ${Number(
        state.elementCount ?? 0,
      )} élément(s), calculés avec ${(state.ruleSets as string[] | undefined)?.join(', ') ?? 'le jeu de règles BatiOne'}.`;
    }
    const floors = (state.floors as string[] | undefined) ?? [];
    return `Métré : ${Number(state.lineCount ?? rows.length)} ligne(s) sur ${floors.length} niveau(x) (${floors.join(
      ', ',
    )}). Les totaux sont recalculés à chaque correction, sans écraser l'historique.`;
  }

  /* ---------------------------------------------------------------- */

  private parsedOf(doc: AiDocumentContext): ParsedDocument | null {
    return (doc.entities as ParsedDocument | undefined) ?? null;
  }

  /** Maps a character offset back to the page it came from. */
  private pageOf(doc: AiDocumentContext, index: number): number {
    const parsed = this.parsedOf(doc);
    if (!parsed?.pages?.length) return 1;
    let cursor = 0;
    for (const page of parsed.pages) {
      cursor += page.text.length + 1;
      if (index < cursor) return page.page;
    }
    return parsed.pages[parsed.pages.length - 1].page;
  }
}

/* -------------------------------------------------------------------- */
/* Local helpers                                                         */
/* -------------------------------------------------------------------- */

function tracedValue<T>(
  value: T,
  confidence: ConfidenceLevel,
  sources: SourceRef[],
): TracedValue<T> {
  return { value, confidence, sources };
}

function tracedDim(
  name: string,
  value: number,
  confidence: ConfidenceLevel,
  sources: SourceRef[],
) {
  return { name, value: tracedValue(round3(value), confidence, sources), unit: 'm' };
}

const ORDER: Record<ConfidenceLevel, number> = {
  user_confirmed: 4,
  certain: 3,
  deduced: 2,
  hypothesis: 1,
};

function weakest(levels: ConfidenceLevel[]): ConfidenceLevel {
  return levels.reduce((acc, cur) => (ORDER[cur] < ORDER[acc] ? cur : acc), levels[0]);
}

function dedupe(refs: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = JSON.stringify(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchClauses(
  clauses: { id: string; category: string }[],
  category: string,
): string[] {
  return clauses.filter((c) => c.category === category).map((c) => c.id).slice(0, 5);
}

/** Annotation lines describing joinery, rooms or finishes carry no rebar. */
const ARCHITECTURAL_LINE =
  /(porte|fen[eê]tre|placard|cuisine|s[eé]jour|chambre|sdb|salle de bain|garage|terrasse|peinture|carrelage)/i;

function structuralTypeFor(reference: string, context: string): string {
  const haystack = `${reference} ${context}`.toLowerCase();
  if (/semelle|sem|fondation/.test(haystack)) return 'semelle';
  if (/poteau|pot\b|^p\d/.test(haystack)) return 'poteau';
  if (/poutre|^po\d/.test(haystack)) return 'poutre';
  if (/longrine|long/.test(haystack)) return 'longrine';
  if (/chain|chaînage|chainage/.test(haystack)) return 'chainage';
  if (/dalle|dal/.test(haystack)) return 'dalle';
  if (/escalier|esc/.test(haystack)) return 'escalier';
  if (/^s\d/i.test(reference)) return 'semelle';
  if (/^p\d/i.test(reference)) return 'poteau';
  return 'poutre';
}

function detectTypes(normalized: string): string[] {
  const types: string[] = [];
  if (/mur/.test(normalized)) types.push('wall');
  if (/dalle|plancher/.test(normalized)) types.push('slab');
  if (/toit|toiture/.test(normalized)) types.push('roof');
  if (/poteau/.test(normalized)) types.push('column');
  if (/fen[eê]tre/.test(normalized)) types.push('window');
  if (/porte/.test(normalized)) types.push('door');
  return types;
}

function floorRank(doc: AiDocumentContext): number {
  const floor = detectFloor(doc.floor, doc.name) ?? 'RDC';
  const ranks: Record<string, number> = {
    Fondations: -2,
    'Sous-sol': -1,
    RDC: 0,
    'R+1': 1,
    'R+2': 2,
    'R+3': 3,
    Toiture: 10,
  };
  return ranks[floor] ?? 0;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
