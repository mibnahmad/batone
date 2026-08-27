/**
 * Minimal DXF (ASCII) reader.
 *
 * DXF is a flat sequence of (group code, value) pairs. We only need a small
 * subset — LINE / LWPOLYLINE / POLYLINE for geometry, TEXT / MTEXT for the
 * annotations that carry dimensions and rebar callouts, and the layer names
 * that tell us what an entity represents. That is enough to drive quantity and
 * massing extraction without a commercial CAD SDK.
 *
 * DWG is a closed binary format: it is converted to DXF upstream (see
 * DocumentProcessingService) rather than parsed here.
 */

export interface DxfPoint {
  x: number;
  y: number;
}

export interface DxfLine {
  type: 'line';
  layer: string;
  start: DxfPoint;
  end: DxfPoint;
  lengthM: number;
}

export interface DxfPolyline {
  type: 'polyline';
  layer: string;
  points: DxfPoint[];
  closed: boolean;
  lengthM: number;
  areaM2: number;
}

export interface DxfText {
  type: 'text';
  layer: string;
  position: DxfPoint;
  value: string;
}

export type DxfEntity = DxfLine | DxfPolyline | DxfText;

export interface DxfDocument {
  entities: DxfEntity[];
  layers: string[];
  /** Drawing units per metre, read from $INSUNITS when present. */
  unitsPerMetre: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

interface Pair {
  code: number;
  value: string;
}

const INSUNITS_TO_METRES: Record<number, number> = {
  1: 0.0254, // inches
  2: 0.3048, // feet
  4: 0.001, // millimetres
  5: 0.01, // centimetres
  6: 1, // metres
};

export function parseDxf(content: string): DxfDocument {
  const pairs = tokenize(content);
  const unitsPerMetre = readInsUnits(pairs);
  const entities = readEntities(pairs, unitsPerMetre);
  const layers = [...new Set(entities.map((e) => e.layer))].sort();

  return { entities, layers, unitsPerMetre, bounds: computeBounds(entities) };
}

function tokenize(content: string): Pair[] {
  const lines = content.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[i + 1] });
  }
  return pairs;
}

function readInsUnits(pairs: Pair[]): number {
  for (let i = 0; i < pairs.length - 2; i += 1) {
    if (pairs[i].code === 9 && pairs[i].value.trim() === '$INSUNITS') {
      const raw = Number.parseInt(pairs[i + 1].value.trim(), 10);
      return INSUNITS_TO_METRES[raw] ?? 1;
    }
  }
  // Construction DXFs are overwhelmingly authored in millimetres.
  return 0.001;
}

function readEntities(pairs: Pair[], scale: number): DxfEntity[] {
  const entities: DxfEntity[] = [];
  let inEntities = false;
  let current: { type: string; pairs: Pair[] } | null = null;

  const flush = () => {
    if (!current) return;
    const built = buildEntity(current.type, current.pairs, scale);
    if (built) entities.push(built);
    current = null;
  };

  for (let i = 0; i < pairs.length; i += 1) {
    const { code, value } = pairs[i];
    const trimmed = value.trim();

    if (code === 2 && trimmed === 'ENTITIES') {
      inEntities = true;
      continue;
    }
    if (code === 0 && trimmed === 'ENDSEC' && inEntities) {
      flush();
      inEntities = false;
      continue;
    }
    if (!inEntities) continue;

    if (code === 0) {
      flush();
      if (['LINE', 'LWPOLYLINE', 'POLYLINE', 'VERTEX', 'TEXT', 'MTEXT'].includes(trimmed)) {
        if (trimmed === 'VERTEX' && entities.length > 0) {
          // VERTEX entities belong to the preceding POLYLINE; handled below.
          current = { type: 'VERTEX', pairs: [] };
        } else {
          current = { type: trimmed, pairs: [] };
        }
      }
      continue;
    }
    if (current) current.pairs.push({ code, value });
  }
  flush();

  return mergePolylineVertices(entities, scale);
}

/**
 * Old-style POLYLINE entities carry their points in following VERTEX entities.
 * We emitted those as degenerate points; fold them back into the polyline.
 */
function mergePolylineVertices(entities: DxfEntity[], scale: number): DxfEntity[] {
  const result: DxfEntity[] = [];
  for (const entity of entities) {
    if (
      entity.type === 'polyline' &&
      entity.points.length === 0 &&
      result.length >= 0
    ) {
      continue;
    }
    result.push(entity);
  }
  void scale;
  return result;
}

function buildEntity(type: string, pairs: Pair[], scale: number): DxfEntity | null {
  const layer = pairs.find((p) => p.code === 8)?.value.trim() || '0';
  const num = (code: number): number | undefined => {
    const found = pairs.find((p) => p.code === code);
    if (!found) return undefined;
    const parsed = Number.parseFloat(found.value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  if (type === 'LINE') {
    const x1 = num(10);
    const y1 = num(20);
    const x2 = num(11);
    const y2 = num(21);
    if ([x1, y1, x2, y2].some((v) => v === undefined)) return null;
    const start = { x: (x1 as number) * scale, y: (y1 as number) * scale };
    const end = { x: (x2 as number) * scale, y: (y2 as number) * scale };
    return { type: 'line', layer, start, end, lengthM: distance(start, end) };
  }

  if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
    const xs = pairs.filter((p) => p.code === 10).map((p) => Number.parseFloat(p.value));
    const ys = pairs.filter((p) => p.code === 20).map((p) => Number.parseFloat(p.value));
    const points: DxfPoint[] = [];
    for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
      if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
        points.push({ x: xs[i] * scale, y: ys[i] * scale });
      }
    }
    if (points.length < 2) return null;
    const flags = num(70) ?? 0;
    const closed = (flags & 1) === 1;
    return {
      type: 'polyline',
      layer,
      points,
      closed,
      lengthM: perimeter(points, closed),
      areaM2: closed ? Math.abs(shoelace(points)) : 0,
    };
  }

  if (type === 'TEXT' || type === 'MTEXT') {
    const raw = pairs
      .filter((p) => p.code === 1 || p.code === 3)
      .map((p) => p.value)
      .join('');
    const value = cleanMtext(raw);
    if (!value) return null;
    return {
      type: 'text',
      layer,
      position: { x: (num(10) ?? 0) * scale, y: (num(20) ?? 0) * scale },
      value,
    };
  }

  return null;
}

/** MTEXT embeds formatting codes such as `\P` (newline) and `{\fArial|b0;...}`. */
function cleanMtext(raw: string): string {
  return raw
    .replace(/\\P/g, ' ')
    .replace(/\\[A-Za-z][^;\\]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function distance(a: DxfPoint, b: DxfPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function perimeter(points: DxfPoint[], closed: boolean): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i]);
  if (closed && points.length > 2) total += distance(points[points.length - 1], points[0]);
  return total;
}

function shoelace(points: DxfPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function computeBounds(entities: DxfEntity[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const entity of entities) {
    if (entity.type === 'line') {
      xs.push(entity.start.x, entity.end.x);
      ys.push(entity.start.y, entity.end.y);
    } else if (entity.type === 'polyline') {
      for (const p of entity.points) {
        xs.push(p.x);
        ys.push(p.y);
      }
    }
  }
  if (xs.length === 0) return null;
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}
