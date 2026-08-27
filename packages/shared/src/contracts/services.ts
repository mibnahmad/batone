/**
 * Structured-output contracts. The AI Gateway will only ever hand the data layer
 * objects that validate against one of these schemas — never free text.
 */
import { z } from 'zod';
import {
  confidenceLevelSchema,
  sourceRefSchema,
  tracedValueSchema,
} from '../domain/traceability';

const tracedNumber = tracedValueSchema(z.number());
const tracedString = tracedValueSchema(z.string());

/* ------------------------------------------------------------------ */
/* Service 1 — Métré automatisé                                        */
/* ------------------------------------------------------------------ */

export const TakeoffUnit = {
  M: 'm',
  M2: 'm2',
  M3: 'm3',
  U: 'u',
  KG: 'kg',
  ML: 'ml',
  FORFAIT: 'ft',
} as const;
export type TakeoffUnit = (typeof TakeoffUnit)[keyof typeof TakeoffUnit];
export const takeoffUnitSchema = z.nativeEnum(TakeoffUnit);

export const takeoffLineExtractionSchema = z.object({
  ouvrage: z.string().min(1),
  description: z.string().default(''),
  category: z.string().default('divers'),
  unit: takeoffUnitSchema,
  floor: z.string().default('RDC'),
  quantity: tracedNumber,
  /** Raw dimensions the quantity was computed from, each individually traced. */
  dimensions: z
    .array(
      z.object({
        name: z.string(),
        value: tracedNumber,
        unit: z.string().default('m'),
      }),
    )
    .default([]),
  /** Ids of CCTP clauses that justify this line existing at all. */
  cctpClauseIds: z.array(z.string()).default([]),
  sources: z.array(sourceRefSchema).default([]),
  confidence: confidenceLevelSchema,
});
export type TakeoffLineExtraction = z.infer<typeof takeoffLineExtractionSchema>;

export const cctpClauseExtractionSchema = z.object({
  reference: z.string().min(1),
  title: z.string().default(''),
  text: z.string().min(1),
  /** Machine-usable rule distilled from the clause, if any. */
  extractedRule: z.string().optional(),
  category: z.string().default('divers'),
  page: z.number().int().positive().optional(),
});
export type CctpClauseExtraction = z.infer<typeof cctpClauseExtractionSchema>;

/* ------------------------------------------------------------------ */
/* Service 2 — 2D → 3D                                                 */
/* ------------------------------------------------------------------ */

export const Element3DType = {
  WALL: 'wall',
  DOOR: 'door',
  WINDOW: 'window',
  SLAB: 'slab',
  ROOF: 'roof',
  STAIR: 'stair',
  COLUMN: 'column',
  BEAM: 'beam',
  SPACE: 'space',
} as const;
export type Element3DType = (typeof Element3DType)[keyof typeof Element3DType];
export const element3DTypeSchema = z.nativeEnum(Element3DType);

/** Axis-aligned box geometry, metres, Y-up. Sufficient for pre-construction massing. */
export const boxGeometrySchema = z.object({
  kind: z.literal('box'),
  position: z.tuple([z.number(), z.number(), z.number()]),
  size: z.tuple([z.number(), z.number(), z.number()]),
  rotationY: z.number().default(0),
});

export const element3DSchema = z.object({
  externalId: z.string().min(1),
  type: element3DTypeSchema,
  name: z.string().default(''),
  floor: z.string().default('RDC'),
  geometry: boxGeometrySchema,
  material: z.string().default('beton'),
  /** Free-form spec attributes enriched from the CCTP (thickness, finish, U-value...). */
  attributes: z.record(z.unknown()).default({}),
  sources: z.array(sourceRefSchema).default([]),
  confidence: confidenceLevelSchema,
});
export type Element3D = z.infer<typeof element3DSchema>;

/**
 * The chat-driven edit engine resolves natural language to exactly one of these
 * operations. Anything it cannot resolve becomes a ClarificationRequest instead.
 */
export const editOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('set_property'),
    selector: z.object({
      types: z.array(element3DTypeSchema).default([]),
      floors: z.array(z.string()).default([]),
      externalIds: z.array(z.string()).default([]),
    }),
    property: z.enum(['height', 'width', 'depth', 'material', 'name']),
    value: z.union([z.number(), z.string()]),
  }),
  z.object({
    op: z.literal('add_element'),
    element: element3DSchema.partial({ sources: true, confidence: true }),
  }),
  z.object({
    op: z.literal('remove_element'),
    externalIds: z.array(z.string()).min(1),
  }),
  z.object({
    op: z.literal('set_visibility'),
    selector: z.object({
      types: z.array(element3DTypeSchema).default([]),
      floors: z.array(z.string()).default([]),
      externalIds: z.array(z.string()).default([]),
    }),
    visible: z.boolean(),
  }),
]);
export type EditOperation = z.infer<typeof editOperationSchema>;

/** What the assistant proposes before the user presses "Appliquer". */
export const editProposalSchema = z.object({
  instruction: z.string(),
  operations: z.array(editOperationSchema).min(1),
  summary: z.string(),
  affectedCount: z.number().int().nonnegative(),
  diff: z
    .array(
      z.object({
        externalId: z.string(),
        property: z.string(),
        before: z.unknown(),
        after: z.unknown(),
      }),
    )
    .default([]),
});
export type EditProposal = z.infer<typeof editProposalSchema>;

/* ------------------------------------------------------------------ */
/* Service 3 — Métré ferraillage                                       */
/* ------------------------------------------------------------------ */

export const StructuralElementType = {
  SEMELLE: 'semelle',
  POTEAU: 'poteau',
  POUTRE: 'poutre',
  LONGRINE: 'longrine',
  CHAINAGE: 'chainage',
  DALLE: 'dalle',
  ESCALIER: 'escalier',
} as const;
export type StructuralElementType =
  (typeof StructuralElementType)[keyof typeof StructuralElementType];
export const structuralElementTypeSchema = z.nativeEnum(StructuralElementType);

/**
 * What the LLM is allowed to produce for service 3: geometry and rebar callouts
 * READ from the drawing. It never produces lengths, weights or bar counts —
 * those come from the deterministic rule engine.
 */
export const structuralElementExtractionSchema = z.object({
  reference: z.string().min(1),
  type: structuralElementTypeSchema,
  floor: z.string().default('Fondations'),
  count: z.number().int().positive().default(1),
  /** Dimensions in metres, each traced to the coupe it was read from. */
  dimensions: z.record(tracedNumber),
  /** Rebar callouts as written on the drawing, e.g. "4HA12" / "cadres HA8 e=20". */
  callouts: z
    .array(
      z.object({
        raw: tracedString,
        role: z.enum(['longitudinal', 'transversal', 'repartition', 'chapeau']),
        diameterMm: tracedNumber.optional(),
        count: tracedNumber.optional(),
        spacingM: tracedNumber.optional(),
      }),
    )
    .default([]),
  concreteCoverM: tracedNumber.optional(),
  sources: z.array(sourceRefSchema).default([]),
  confidence: confidenceLevelSchema,
});
export type StructuralElementExtraction = z.infer<
  typeof structuralElementExtractionSchema
>;

/** Output of the deterministic rebar rule engine. */
export const rebarLineSchema = z.object({
  elementReference: z.string(),
  role: z.string(),
  diameterMm: z.number().positive(),
  unitLengthM: z.number().nonnegative(),
  count: z.number().int().nonnegative(),
  totalLengthM: z.number().nonnegative(),
  unitMassKgPerM: z.number().nonnegative(),
  totalWeightKg: z.number().nonnegative(),
  ruleId: z.string(),
  ruleVersion: z.string(),
  /** Human-readable arithmetic, e.g. "L = 2*(a+b) - 8*c + 2*10*d". */
  computation: z.string(),
  sources: z.array(sourceRefSchema).default([]),
  confidence: confidenceLevelSchema,
});
export type RebarLine = z.infer<typeof rebarLineSchema>;

/* ------------------------------------------------------------------ */
/* Service 4 — Étude de prix                                           */
/* ------------------------------------------------------------------ */

export const priceItemInputSchema = z.object({
  code: z.string().default(''),
  designation: z.string().min(1),
  category: z.string().default('divers'),
  unit: z.string().min(1),
  quantity: z.number(),
  unitPriceMaterials: z.number().nonnegative().default(0),
  unitPriceLabour: z.number().nonnegative().default(0),
  unitPriceEquipment: z.number().nonnegative().default(0),
  sources: z.array(sourceRefSchema).default([]),
  confidence: confidenceLevelSchema.default('user_confirmed'),
});
export type PriceItemInput = z.infer<typeof priceItemInputSchema>;

export const priceBreakdownSchema = z.object({
  currency: z.string().default('EUR'),
  directCost: z.number(),
  materialsCost: z.number(),
  labourCost: z.number(),
  equipmentCost: z.number(),
  overheadRate: z.number(),
  overheadAmount: z.number(),
  marginRate: z.number(),
  marginAmount: z.number(),
  preTaxTotal: z.number(),
  vatRate: z.number(),
  vatAmount: z.number(),
  finalPrice: z.number(),
  ruleId: z.string(),
  ruleVersion: z.string(),
  steps: z.array(
    z.object({
      label: z.string(),
      formula: z.string(),
      amount: z.number(),
    }),
  ),
});
export type PriceBreakdown = z.infer<typeof priceBreakdownSchema>;
