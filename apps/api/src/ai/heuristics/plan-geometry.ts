import type { DxfDocument, DxfEntity } from '../../documents/parsers/dxf.parser';

/**
 * Layer-name classification. French and English CAD conventions both appear in
 * practice, and layer naming is never fully standardised, so a match here is
 * evidence rather than proof — callers downgrade confidence accordingly.
 */
export type PlanCategory =
  | 'wall'
  | 'opening'
  | 'slab'
  | 'roof'
  | 'stair'
  | 'column'
  | 'beam'
  | 'dimension'
  | 'unknown';

const LAYER_PATTERNS: { category: PlanCategory; pattern: RegExp }[] = [
  { category: 'wall', pattern: /(mur|wall|cloison|paroi|a-wall)/i },
  { category: 'opening', pattern: /(porte|fenetre|fenêtre|door|window|ouvertur|baie)/i },
  { category: 'slab', pattern: /(dalle|plancher|slab|sol|floor)/i },
  { category: 'roof', pattern: /(toit|toiture|roof|charpente)/i },
  { category: 'stair', pattern: /(escalier|stair|marche)/i },
  { category: 'column', pattern: /(poteau|column|colonne)/i },
  { category: 'beam', pattern: /(poutre|beam|linteau|longrine|chainage|chaînage)/i },
  { category: 'dimension', pattern: /(cotation|dim|annot|texte|text)/i },
];

export function classifyLayer(layer: string): PlanCategory {
  for (const { category, pattern } of LAYER_PATTERNS) {
    if (pattern.test(layer)) return category;
  }
  return 'unknown';
}

export interface WallSegment {
  layer: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  lengthM: number;
}

export interface PlanGeometry {
  walls: WallSegment[];
  /** Closed polygons classified as slabs/floor outline. */
  slabs: { layer: string; areaM2: number; perimeterM: number }[];
  columns: number;
  openings: number;
  stairs: number;
  totalWallLengthM: number;
  totalSlabAreaM2: number;
  bounds: DxfDocument['bounds'];
  /** Text annotations, kept for dimension and callout mining. */
  annotations: string[];
}

export function readPlanGeometry(cad: DxfDocument): PlanGeometry {
  const walls: WallSegment[] = [];
  const slabs: PlanGeometry['slabs'] = [];
  const annotations: string[] = [];
  let columns = 0;
  let openings = 0;
  let stairs = 0;

  const consider = (entity: DxfEntity) => {
    const category = classifyLayer(entity.layer);
    if (entity.type === 'text') {
      annotations.push(entity.value);
      if (/porte|fen[eê]tre|door|window/i.test(entity.value)) openings += 1;
      return;
    }
    if (entity.type === 'line') {
      // Zero-length and hairline artefacts are noise, not building fabric.
      if (entity.lengthM < 0.05) return;
      if (category === 'wall' || category === 'unknown') {
        walls.push({
          layer: entity.layer,
          start: entity.start,
          end: entity.end,
          lengthM: entity.lengthM,
        });
      }
      if (category === 'stair') stairs += 1;
      return;
    }
    if (entity.type === 'polyline') {
      if (entity.closed && entity.areaM2 > 0.5) {
        if (category === 'column' || entity.areaM2 < 1.5) {
          columns += 1;
        } else {
          slabs.push({
            layer: entity.layer,
            areaM2: entity.areaM2,
            perimeterM: entity.lengthM,
          });
        }
        return;
      }
      if (category === 'wall' || category === 'unknown') {
        for (let i = 1; i < entity.points.length; i += 1) {
          const a = entity.points[i - 1];
          const b = entity.points[i];
          const lengthM = Math.hypot(b.x - a.x, b.y - a.y);
          if (lengthM >= 0.05) walls.push({ layer: entity.layer, start: a, end: b, lengthM });
        }
      }
      if (category === 'stair') stairs += 1;
    }
  };

  cad.entities.forEach(consider);

  return {
    walls,
    slabs,
    columns,
    openings,
    stairs,
    totalWallLengthM: round(walls.reduce((sum, w) => sum + w.lengthM, 0)),
    totalSlabAreaM2: round(slabs.reduce((sum, s) => sum + s.areaM2, 0)),
    bounds: cad.bounds,
    annotations,
  };
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
