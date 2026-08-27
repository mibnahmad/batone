/**
 * Minimal, dependency-free glTF 2.0 / OBJ writer for the 2D→3D service.
 *
 * The model is axis-aligned massing (boxes), so a single unit-cube mesh reused
 * through node transforms produces a small, valid file that opens in Blender,
 * Windows 3D Viewer, three.js and the usual BIM viewers.
 */

export interface ExportableElement {
  externalId: string;
  type: string;
  name: string;
  floor: string;
  material: string;
  geometry: unknown;
  visible?: boolean;
}

interface Box {
  position: [number, number, number];
  size: [number, number, number];
  rotationY: number;
}

const MATERIAL_COLORS: Record<string, [number, number, number, number]> = {
  beton: [0.72, 0.72, 0.7, 1],
  beton_arme: [0.62, 0.63, 0.62, 1],
  parpaing: [0.78, 0.75, 0.68, 1],
  brique: [0.7, 0.35, 0.25, 1],
  bois: [0.6, 0.42, 0.24, 1],
  acier: [0.55, 0.57, 0.6, 1],
  verre: [0.6, 0.8, 0.9, 0.35],
  platre: [0.92, 0.92, 0.9, 1],
  isolant: [0.95, 0.85, 0.4, 1],
  tuile: [0.65, 0.3, 0.2, 1],
};

const TYPE_COLORS: Record<string, [number, number, number, number]> = {
  window: [0.6, 0.8, 0.9, 0.35],
  door: [0.55, 0.4, 0.28, 1],
};

/* -- unit cube (centred on origin, per-face normals) ------------------ */

const CUBE_POSITIONS: number[] = [];
const CUBE_NORMALS: number[] = [];
const CUBE_INDICES: number[] = [];

(() => {
  const faces: { normal: [number, number, number]; corners: [number, number, number][] }[] = [
    { normal: [0, 0, 1], corners: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { normal: [0, 0, -1], corners: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
    { normal: [1, 0, 0], corners: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
    { normal: [-1, 0, 0], corners: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
    { normal: [0, 1, 0], corners: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
    { normal: [0, -1, 0], corners: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  ];

  faces.forEach((face, faceIndex) => {
    for (const corner of face.corners) {
      CUBE_POSITIONS.push(...corner);
      CUBE_NORMALS.push(...face.normal);
    }
    const base = faceIndex * 4;
    CUBE_INDICES.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
})();

function readBox(geometry: unknown): Box | null {
  const box = geometry as Partial<Box> | null;
  if (!box || !Array.isArray(box.position) || !Array.isArray(box.size)) return null;
  const [px, py, pz] = box.position as number[];
  const [sx, sy, sz] = box.size as number[];
  if (![px, py, pz, sx, sy, sz].every((value) => Number.isFinite(value))) return null;
  return {
    position: [px, py, pz],
    size: [Math.max(sx, 0.001), Math.max(sy, 0.001), Math.max(sz, 0.001)],
    rotationY: Number.isFinite(box.rotationY) ? (box.rotationY as number) : 0,
  };
}

function colorFor(element: ExportableElement): [number, number, number, number] {
  return (
    TYPE_COLORS[element.type] ??
    MATERIAL_COLORS[element.material] ?? [0.75, 0.75, 0.75, 1]
  );
}

/** glTF is Y-up right-handed like our geometry, so no axis conversion is needed. */
export function buildGltf(elements: ExportableElement[]): Record<string, unknown> {
  const { json, binary } = buildGltfParts(elements);
  json.buffers = [
    {
      byteLength: binary.length,
      uri: `data:application/octet-stream;base64,${binary.toString('base64')}`,
    },
  ];
  return json;
}

export function buildGlb(elements: ExportableElement[]): Buffer {
  const { json, binary } = buildGltfParts(elements);
  json.buffers = [{ byteLength: binary.length }];

  const jsonBuffer = padTo4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binBuffer = padTo4(binary, 0x00);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuffer.length + 8 + binBuffer.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuffer.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // "BIN"

  return Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, binBuffer]);
}

function buildGltfParts(elements: ExportableElement[]): {
  json: Record<string, unknown>;
  binary: Buffer;
} {
  const positions = Buffer.alloc(CUBE_POSITIONS.length * 4);
  CUBE_POSITIONS.forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const normals = Buffer.alloc(CUBE_NORMALS.length * 4);
  CUBE_NORMALS.forEach((value, index) => normals.writeFloatLE(value, index * 4));
  const indices = Buffer.alloc(CUBE_INDICES.length * 2);
  CUBE_INDICES.forEach((value, index) => indices.writeUInt16LE(value, index * 2));

  const binary = Buffer.concat([positions, normals, padTo4(indices, 0x00)]);

  /* One material + one mesh per distinct (material, type) colour bucket. */
  const buckets = new Map<string, { color: [number, number, number, number]; name: string }>();
  for (const element of elements) {
    const key = `${element.material}::${element.type}`;
    if (!buckets.has(key)) {
      buckets.set(key, { color: colorFor(element), name: `${element.material}_${element.type}` });
    }
  }
  const bucketKeys = [...buckets.keys()];

  const materials = bucketKeys.map((key) => {
    const bucket = buckets.get(key)!;
    return {
      name: bucket.name,
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: bucket.color,
        metallicFactor: bucket.color[3] < 1 ? 0.1 : 0.05,
        roughnessFactor: 0.85,
      },
      ...(bucket.color[3] < 1 ? { alphaMode: 'BLEND' } : {}),
    };
  });

  const meshes = bucketKeys.map((key, index) => ({
    name: buckets.get(key)!.name,
    primitives: [
      {
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: 2,
        material: index,
        mode: 4,
      },
    ],
  }));

  const nodes: Record<string, unknown>[] = [];
  for (const element of elements) {
    if (element.visible === false) continue;
    const box = readBox(element.geometry);
    if (!box) continue;
    const meshIndex = bucketKeys.indexOf(`${element.material}::${element.type}`);
    const halfAngle = box.rotationY / 2;

    nodes.push({
      name: `${element.externalId}_${element.type}_${element.floor}`,
      mesh: meshIndex >= 0 ? meshIndex : 0,
      translation: box.position,
      rotation: [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)],
      scale: box.size,
      extras: {
        externalId: element.externalId,
        type: element.type,
        floor: element.floor,
        material: element.material,
        name: element.name,
      },
    });
  }

  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'BatiOne Construction' },
    scene: 0,
    scenes: [{ name: 'BatiOne', nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes,
    materials,
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: CUBE_POSITIONS.length / 3,
        type: 'VEC3',
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      },
      { bufferView: 1, componentType: 5126, count: CUBE_NORMALS.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: CUBE_INDICES.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 },
      { buffer: 0, byteOffset: positions.length, byteLength: normals.length, target: 34962 },
      {
        buffer: 0,
        byteOffset: positions.length + normals.length,
        byteLength: indices.length,
        target: 34963,
      },
    ],
  };

  return { json, binary };
}

/** Wavefront OBJ — one group per element so element identity survives export. */
export function buildObj(elements: ExportableElement[]): string {
  const lines: string[] = [
    '# BatiOne Construction — export OBJ',
    '# Visualisation pré-construction, sans valeur d’exécution.',
    `# ${new Date().toISOString()}`,
    '',
  ];

  let vertexOffset = 1;
  for (const element of elements) {
    if (element.visible === false) continue;
    const box = readBox(element.geometry);
    if (!box) continue;

    lines.push(`g ${element.externalId}_${element.type}_${element.floor}`);
    lines.push(`usemtl ${element.material}`);

    const cos = Math.cos(box.rotationY);
    const sin = Math.sin(box.rotationY);

    for (let i = 0; i < CUBE_POSITIONS.length; i += 3) {
      const x = CUBE_POSITIONS[i] * box.size[0];
      const y = CUBE_POSITIONS[i + 1] * box.size[1];
      const z = CUBE_POSITIONS[i + 2] * box.size[2];
      const rx = x * cos + z * sin;
      const rz = -x * sin + z * cos;
      lines.push(
        `v ${round(rx + box.position[0])} ${round(y + box.position[1])} ${round(rz + box.position[2])}`,
      );
    }

    for (let i = 0; i < CUBE_INDICES.length; i += 3) {
      lines.push(
        `f ${CUBE_INDICES[i] + vertexOffset} ${CUBE_INDICES[i + 1] + vertexOffset} ${
          CUBE_INDICES[i + 2] + vertexOffset
        }`,
      );
    }

    vertexOffset += CUBE_POSITIONS.length / 3;
    lines.push('');
  }

  return lines.join('\n');
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function padTo4(buffer: Buffer, fill: number): Buffer {
  const remainder = buffer.length % 4;
  if (remainder === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(4 - remainder, fill)]);
}
