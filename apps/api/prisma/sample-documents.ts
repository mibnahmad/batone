import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';

export interface SampleFile {
  filename: string;
  buffer: Buffer;
}

/* ------------------------------------------------------------------ *
 * ASCII DXF writer
 * ------------------------------------------------------------------ */

interface DxfLine {
  layer: string;
  from: [number, number];
  to: [number, number];
}

interface DxfPolyline {
  layer: string;
  points: [number, number][];
}

interface DxfText {
  layer: string;
  at: [number, number];
  value: string;
  height?: number;
}

function dxf(entities: {
  lines?: DxfLine[];
  polylines?: DxfPolyline[];
  texts?: DxfText[];
  layers?: string[];
}): Buffer {
  const out: string[] = [];
  const push = (code: number, value: string | number) => {
    out.push(String(code), String(value));
  };

  push(0, 'SECTION');
  push(2, 'HEADER');
  push(9, '$INSUNITS');
  push(70, 6); // metres
  push(0, 'ENDSEC');

  push(0, 'SECTION');
  push(2, 'TABLES');
  push(0, 'TABLE');
  push(2, 'LAYER');
  for (const layer of entities.layers ?? []) {
    push(0, 'LAYER');
    push(2, layer);
    push(70, 0);
    push(62, 7);
  }
  push(0, 'ENDTAB');
  push(0, 'ENDSEC');

  push(0, 'SECTION');
  push(2, 'ENTITIES');

  for (const line of entities.lines ?? []) {
    push(0, 'LINE');
    push(8, line.layer);
    push(10, line.from[0]);
    push(20, line.from[1]);
    push(30, 0);
    push(11, line.to[0]);
    push(21, line.to[1]);
    push(31, 0);
  }

  for (const polyline of entities.polylines ?? []) {
    push(0, 'LWPOLYLINE');
    push(8, polyline.layer);
    push(90, polyline.points.length);
    push(70, 1); // closed
    for (const [x, y] of polyline.points) {
      push(10, x);
      push(20, y);
    }
  }

  for (const text of entities.texts ?? []) {
    push(0, 'TEXT');
    push(8, text.layer);
    push(10, text.at[0]);
    push(20, text.at[1]);
    push(30, 0);
    push(40, text.height ?? 0.25);
    push(1, text.value);
  }

  push(0, 'ENDSEC');
  push(0, 'EOF');

  return Buffer.from(out.join('\n'), 'utf8');
}

/** Rectangular room outline expressed as four wall centre-lines. */
function rectWalls(
  layer: string,
  x: number,
  y: number,
  width: number,
  depth: number,
): DxfLine[] {
  return [
    { layer, from: [x, y], to: [x + width, y] },
    { layer, from: [x + width, y], to: [x + width, y + depth] },
    { layer, from: [x + width, y + depth], to: [x, y + depth] },
    { layer, from: [x, y + depth], to: [x, y] },
  ];
}

export function groundFloorPlan(): SampleFile {
  const walls = [
    ...rectWalls('MURS', 0, 0, 12, 9),
    { layer: 'MURS' as const, from: [5, 0] as [number, number], to: [5, 9] as [number, number] },
    { layer: 'MURS' as const, from: [5, 5] as [number, number], to: [12, 5] as [number, number] },
  ];

  return {
    filename: 'plan-rdc.dxf',
    buffer: dxf({
      layers: ['MURS', 'DALLE', 'OUVERTURES', 'COTATION', 'TEXTE'],
      lines: [
        ...walls,
        { layer: 'OUVERTURES', from: [1.2, 0], to: [2.1, 0] },
        { layer: 'OUVERTURES', from: [7.5, 0], to: [8.9, 0] },
        { layer: 'OUVERTURES', from: [0, 3.4], to: [0, 4.8] },
        { layer: 'OUVERTURES', from: [12, 6.2], to: [12, 7.6] },
      ],
      polylines: [
        {
          layer: 'DALLE',
          points: [
            [0, 0],
            [12, 0],
            [12, 9],
            [0, 9],
          ],
        },
      ],
      texts: [
        { layer: 'TEXTE', at: [1, 8.4], value: 'PLAN RDC - Villa R+1' },
        { layer: 'TEXTE', at: [1, 8.0], value: 'HSP 2,70 m' },
        { layer: 'TEXTE', at: [1, 7.6], value: 'Murs exterieurs ep. 20 cm - parpaing creux' },
        { layer: 'TEXTE', at: [1, 7.2], value: 'Murs de refend ep. 20 cm' },
        { layer: 'TEXTE', at: [1, 6.8], value: 'Dalle beton arme ep. 20 cm' },
        { layer: 'TEXTE', at: [6, 2.5], value: 'SEJOUR 34,80 m2' },
        { layer: 'TEXTE', at: [1.5, 2.5], value: 'CUISINE 12,40 m2' },
        { layer: 'TEXTE', at: [8, 6.5], value: 'CHAMBRE 1 14,00 m2' },
        { layer: 'COTATION', at: [6, 0.3], value: '12,00' },
        { layer: 'COTATION', at: [0.3, 4.5], value: '9,00' },
        { layer: 'TEXTE', at: [1, 0.5], value: 'Porte P1 0,90 x 2,15' },
        { layer: 'TEXTE', at: [7.5, 0.5], value: 'Fenetre F1 1,40 x 1,20' },
      ],
    }),
  };
}

export function firstFloorPlan(): SampleFile {
  return {
    filename: 'plan-r1.dxf',
    buffer: dxf({
      layers: ['MURS', 'DALLE', 'OUVERTURES', 'TEXTE'],
      lines: [
        ...rectWalls('MURS', 0, 0, 12, 9),
        { layer: 'MURS', from: [6, 0], to: [6, 9] },
        { layer: 'MURS', from: [0, 4.5], to: [6, 4.5] },
        { layer: 'OUVERTURES', from: [2.4, 0], to: [3.8, 0] },
        { layer: 'OUVERTURES', from: [8.4, 9], to: [9.8, 9] },
      ],
      polylines: [
        {
          layer: 'DALLE',
          points: [
            [0, 0],
            [12, 0],
            [12, 9],
            [0, 9],
          ],
        },
      ],
      texts: [
        { layer: 'TEXTE', at: [1, 8.4], value: 'PLAN R+1 - Villa R+1' },
        { layer: 'TEXTE', at: [1, 8.0], value: 'HSP 2,60 m' },
        { layer: 'TEXTE', at: [1, 7.6], value: 'Murs ep. 20 cm - parpaing creux' },
        { layer: 'TEXTE', at: [1, 7.2], value: 'Dalle beton arme ep. 20 cm' },
        { layer: 'TEXTE', at: [3, 2.2], value: 'CHAMBRE 2 15,60 m2' },
        { layer: 'TEXTE', at: [9, 2.2], value: 'CHAMBRE 3 16,20 m2' },
        { layer: 'TEXTE', at: [3, 6.8], value: 'SDB 6,40 m2' },
      ],
    }),
  };
}

/**
 * Structural sections with the rebar call-outs the ferraillage engine reads.
 * One element (the longrine) deliberately omits its stirrup spacing so the
 * clarification mechanism is visible in the demo.
 */
export function structuralSection(): SampleFile {
  return {
    filename: 'coupes-structure.dxf',
    buffer: dxf({
      layers: ['COUPE', 'TEXTE'],
      lines: [
        ...rectWalls('COUPE', 0, 0, 1.2, 1.2),
        ...rectWalls('COUPE', 2, 0, 0.2, 1.2),
        ...rectWalls('COUPE', 4, 0, 0.25, 0.5),
      ],
      texts: [
        { layer: 'TEXTE', at: [0, 1.6], value: 'COUPES STRUCTURE - Villa R+1' },
        { layer: 'TEXTE', at: [0, 1.4], value: 'Enrobage 3 cm - Acier HA FeE500' },
        {
          layer: 'TEXTE',
          at: [0, -0.4],
          value: 'S1 semelle isolee 120x120 ep. 40 - 8HA12 - cadres HA8 e=20 - L=1,20',
        },
        {
          layer: 'TEXTE',
          at: [2, -0.4],
          value: 'P1 poteau 20x20 - 4HA12 - cadres HA8 e=20 - L=3,00',
        },
        {
          layer: 'TEXTE',
          at: [4, -0.4],
          value: 'PT1 poutre 25x50 - 6HA14 - cadres HA8 e=15 - L=5,00',
        },
        {
          layer: 'TEXTE',
          at: [6, -0.4],
          // Volontairement incomplet : ni le nombre de barres filantes ni
          // l'espacement des cadres ne sont lisibles, ce qui déclenche le
          // moteur de clarification au lieu d'une valeur inventée.
          value: 'LG1 longrine 20x40 - HA12 - cadres HA8 - L=4,00',
        },
        {
          layer: 'TEXTE',
          at: [8, -0.4],
          value: 'CH1 chainage 20x20 - 4HA10 - cadres HA6 e=20 - L=12,00',
        },
      ],
    }),
  };
}

/* ------------------------------------------------------------------ *
 * CCTP (specifications) — a real PDF with extractable text
 * ------------------------------------------------------------------ */

const CCTP_CLAUSES: [string, string][] = [
  [
    '1.1 Terrassement',
    'Les fouilles en rigole pour semelles filantes seront exécutées à une profondeur minimale de 0,80 m sous le niveau du terrain naturel. Le fond de fouille sera dressé et compacté. Le métré est établi en mètres cubes de déblais en place.',
  ],
  [
    '2.1 Béton de propreté',
    "Un béton de propreté dosé à 150 kg/m3 d'épaisseur 5 cm sera coulé sur toute la surface des fonds de fouille avant ferraillage. Il est décompté en mètres carrés.",
  ],
  [
    '2.2 Semelles et longrines',
    'Le béton armé des semelles et longrines sera dosé à 350 kg/m3 de CEM II 42,5. Les aciers sont de nuance FeE500 haute adhérence. L’enrobage minimal est de 3 cm. Le métré du béton est en mètres cubes, les aciers en kilogrammes.',
  ],
  [
    '3.1 Maçonnerie de parpaing',
    "Les murs extérieurs seront réalisés en blocs creux de béton de 20 cm d'épaisseur, hourdés au mortier bâtard. Le métré est établi en mètres carrés de surface nette, déduction faite des ouvertures supérieures à 0,50 m2.",
  ],
  [
    '3.2 Cloisons de distribution',
    "Les cloisons intérieures seront en briques creuses de 10 cm d'épaisseur enduites sur les deux faces. Le métré est en mètres carrés.",
  ],
  [
    '4.1 Dalle en béton armé',
    "Le plancher haut sera une dalle pleine en béton armé de 20 cm d'épaisseur, dosée à 350 kg/m3. La surface est décomptée en mètres carrés de surface horizontale nette.",
  ],
  [
    '4.2 Chaînages',
    'Un chaînage horizontal continu de section 20x20 cm sera réalisé en tête de tous les murs porteurs. Les aciers longitudinaux seront de 4 HA10 avec cadres HA6 espacés de 20 cm.',
  ],
  [
    '5.1 Enduits',
    'Les enduits extérieurs seront exécutés en trois couches sur une épaisseur totale de 2 cm. Le métré est en mètres carrés de surface développée.',
  ],
  [
    '6.1 Menuiseries extérieures',
    "Les fenêtres seront en aluminium à rupture de pont thermique avec double vitrage 4/16/4. Elles sont décomptées à l'unité par dimension.",
  ],
  [
    '6.2 Portes intérieures',
    "Les portes intérieures seront à âme alvéolaire, dimensions 0,90 x 2,15 m, décomptées à l'unité.",
  ],
  [
    '7.1 Peinture',
    "Les murs intérieurs recevront une impression et deux couches de peinture acrylique mate. Le métré est en mètres carrés de surface traitée.",
  ],
  [
    '8.1 Limites de prestation',
    "Le présent CCTP ne se substitue pas aux notes de calcul de structure ni aux avis du bureau de contrôle. Toute contradiction entre plans et CCTP doit être signalée au maître d'œuvre avant exécution.",
  ],
];

export function cctpDocument(): Promise<SampleFile> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () =>
      resolve({ filename: 'cctp-villa-r1.pdf', buffer: Buffer.concat(chunks) }),
    );
    doc.on('error', reject);

    doc.fontSize(18).text('CAHIER DES CLAUSES TECHNIQUES PARTICULIERES');
    doc.moveDown(0.3);
    doc.fontSize(12).text('Projet : Villa R+1 — Lot gros œuvre et second œuvre');
    doc.moveDown(1);

    for (const [reference, text] of CCTP_CLAUSES) {
      doc.fontSize(11).text(`Article ${reference}`);
      doc.fontSize(10).text(text, { align: 'justify' });
      doc.moveDown(0.6);
    }

    doc.end();
  });
}

/* ------------------------------------------------------------------ *
 * Bordereau de quantités (price study input)
 * ------------------------------------------------------------------ */

export function quantitiesBordereau(): SampleFile {
  const rows = [
    ['Code', 'Designation', 'Categorie', 'Unite', 'Quantite', 'PU materiaux', 'PU main d oeuvre', 'PU materiel'],
    ['1.1', 'Fouilles en rigole', 'terrassement', 'm3', '38.400', '0', '18.00', '12.50'],
    ['2.1', 'Beton de proprete ep. 5 cm', 'fondations', 'm2', '96.000', '9.20', '6.00', '1.80'],
    ['2.2', 'Beton arme semelles', 'fondations', 'm3', '22.500', '118.00', '46.00', '14.00'],
    ['3.1', 'Maconnerie parpaing ep. 20 cm', 'maconnerie', 'm2', '268.400', '21.50', '17.00', '2.40'],
    ['3.2', 'Cloisons briques ep. 10 cm', 'maconnerie', 'm2', '112.000', '13.80', '14.50', '1.60'],
    ['4.1', 'Dalle beton arme ep. 20 cm', 'structure', 'm2', '216.000', '38.00', '22.00', '6.50'],
    ['4.2', 'Chainage 20x20', 'structure', 'm', '84.000', '11.20', '9.40', '1.20'],
    ['5.1', 'Enduit exterieur 3 couches', 'finitions', 'm2', '268.400', '7.40', '12.00', '1.10'],
    ['6.1', 'Fenetre alu 1,40 x 1,20', 'menuiserie', 'u', '8.000', '410.00', '85.00', '0'],
    ['6.2', 'Porte interieure 0,90 x 2,15', 'menuiserie', 'u', '11.000', '165.00', '48.00', '0'],
    ['7.1', 'Peinture murs interieurs', 'finitions', 'm2', '410.000', '4.60', '9.80', '0.40'],
  ];

  return {
    filename: 'bordereau-quantites.csv',
    buffer: Buffer.from(rows.map((row) => row.join(',')).join('\n'), 'utf8'),
  };
}

/** Multer keeps a `fieldname`/`buffer` shape; the seed reuses the real upload path. */
export function asUploadedFile(sample: SampleFile): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: sample.filename,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: sample.buffer.length,
    buffer: sample.buffer,
    destination: '',
    filename: randomUUID(),
    path: '',
    stream: undefined as never,
  };
}
