/**
 * Core cross-cutting domain vocabulary shared by all four BatiOne services.
 *
 * The types in this file encode the platform's non-negotiable product rule:
 * no AI-derived value exists without a provenance record and a confidence tier.
 */
import { z } from 'zod';

/** The four independently-sellable services. */
export const ServiceId = {
  TAKEOFF: 'takeoff',
  MODEL_3D: 'model3d',
  REBAR: 'rebar',
  PRICE_STUDY: 'price_study',
} as const;
export type ServiceId = (typeof ServiceId)[keyof typeof ServiceId];
export const serviceIdSchema = z.nativeEnum(ServiceId);

export const SERVICE_IDS: ServiceId[] = Object.values(ServiceId);

export const SERVICE_LABELS: Record<ServiceId, string> = {
  [ServiceId.TAKEOFF]: 'Métré automatisé',
  [ServiceId.MODEL_3D]: '2D → 3D',
  [ServiceId.REBAR]: 'Métré ferraillage',
  [ServiceId.PRICE_STUDY]: 'Étude de prix',
};

/**
 * Quota is counted per service in its own natural unit.
 */
export const SERVICE_QUOTA_UNIT: Record<ServiceId, string> = {
  [ServiceId.TAKEOFF]: 'plans',
  [ServiceId.MODEL_3D]: 'plans',
  [ServiceId.REBAR]: 'plans',
  [ServiceId.PRICE_STUDY]: 'études',
};

/**
 * Confidence tiers. Ordered from strongest to weakest.
 *
 * - `certain`        value read directly from a document; REQUIRES a bound SourceRef.
 * - `deduced`        derived from document data through a stated deduction.
 * - `hypothesis`     assumed because the documents are silent; must be surfaced to the user.
 * - `user_confirmed` a human validated or supplied the value; outranks everything.
 */
export const ConfidenceLevel = {
  CERTAIN: 'certain',
  DEDUCED: 'deduced',
  HYPOTHESIS: 'hypothesis',
  USER_CONFIRMED: 'user_confirmed',
} as const;
export type ConfidenceLevel = (typeof ConfidenceLevel)[keyof typeof ConfidenceLevel];
export const confidenceLevelSchema = z.nativeEnum(ConfidenceLevel);

/** Numeric weight used to compare tiers and to decide when to ask a question. */
export const CONFIDENCE_WEIGHT: Record<ConfidenceLevel, number> = {
  [ConfidenceLevel.USER_CONFIRMED]: 1.0,
  [ConfidenceLevel.CERTAIN]: 0.9,
  [ConfidenceLevel.DEDUCED]: 0.6,
  [ConfidenceLevel.HYPOTHESIS]: 0.3,
};

/** Tiers that are acceptable without human intervention before finalizing a result. */
export const AUTO_ACCEPTABLE_CONFIDENCE: ConfidenceLevel[] = [
  ConfidenceLevel.USER_CONFIRMED,
  ConfidenceLevel.CERTAIN,
  ConfidenceLevel.DEDUCED,
];

/**
 * A pointer from a produced value back into the material that justifies it.
 * At least one of `page`/`region`/`clauseId`/`ruleId` must be present, otherwise
 * the reference does not actually locate anything and is rejected by the gateway.
 */
export const sourceRefSchema = z
  .object({
    documentId: z.string().optional(),
    /** 1-based page number inside the source document. */
    page: z.number().int().positive().optional(),
    /** Normalized (0..1) bounding box within the page: [x, y, width, height]. */
    region: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    /** Id of the CCTP clause that justifies the value (service 1). */
    clauseId: z.string().optional(),
    /** Id + version of the deterministic rule that produced the value (services 1, 3, 4). */
    ruleId: z.string().optional(),
    ruleVersion: z.string().optional(),
    /** Verbatim snippet from the source, for display in the "where does this come from?" panel. */
    excerpt: z.string().max(2000).optional(),
    note: z.string().max(2000).optional(),
  })
  .refine(
    (r) => Boolean(r.page || r.region || r.clauseId || r.ruleId),
    'A SourceRef must locate something: page, region, clauseId or ruleId is required.',
  );
export type SourceRef = z.infer<typeof sourceRefSchema>;

/**
 * Envelope wrapping every AI-derived value in the system.
 * `T` is the actual payload (a number, a string, a structured object...).
 */
export const tracedValueSchema = <T extends z.ZodTypeAny>(value: T) =>
  z
    .object({
      value: value,
      confidence: confidenceLevelSchema,
      /** Model/engine self-reported score in [0,1], used against the clarification threshold. */
      score: z.number().min(0).max(1).optional(),
      sources: z.array(sourceRefSchema).default([]),
      reasoning: z.string().max(4000).optional(),
    })
    .superRefine((v, ctx) => {
      if (v.confidence === ConfidenceLevel.CERTAIN && v.sources.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sources'],
          message:
            'A value may not be reported as "certain" without at least one bound source reference.',
        });
      }
    });

export type TracedValue<T> = {
  value: T;
  confidence: ConfidenceLevel;
  score?: number;
  sources: SourceRef[];
  reasoning?: string;
};

/** One entry of an append-only correction log. Values are never overwritten silently. */
export const correctionEntrySchema = z.object({
  at: z.string().datetime(),
  by: z.string(),
  field: z.string(),
  previousValue: z.unknown(),
  newValue: z.unknown(),
  previousConfidence: confidenceLevelSchema,
  newConfidence: confidenceLevelSchema,
  reason: z.string().max(2000).optional(),
});
export type CorrectionEntry = z.infer<typeof correctionEntrySchema>;

/** Status of a value that the AI refused to guess. */
export const ClarificationStatus = {
  OPEN: 'open',
  ANSWERED: 'answered',
  DISMISSED: 'dismissed',
} as const;
export type ClarificationStatus =
  (typeof ClarificationStatus)[keyof typeof ClarificationStatus];

export const ClarificationKind = {
  MISSING_DATA: 'missing_data',
  CONTRADICTION: 'contradiction',
  LOW_CONFIDENCE: 'low_confidence',
  AMBIGUOUS_INSTRUCTION: 'ambiguous_instruction',
} as const;
export type ClarificationKind = (typeof ClarificationKind)[keyof typeof ClarificationKind];

export const clarificationRequestSchema = z.object({
  kind: z.nativeEnum(ClarificationKind),
  /** Dotted path of the blocked field, e.g. "takeoffLine:abc123.quantity". */
  targetPath: z.string(),
  question: z.string().min(3),
  options: z.array(z.string()).default([]),
  sources: z.array(sourceRefSchema).default([]),
});
export type ClarificationRequest = z.infer<typeof clarificationRequestSchema>;
