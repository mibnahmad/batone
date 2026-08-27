import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ConfidenceLevel,
  CONFIDENCE_WEIGHT,
  CorrectionEntry,
  SourceRef,
  sourceRefSchema,
} from '@batione/shared';

export interface CorrectionInput {
  field: string;
  previousValue: unknown;
  newValue: unknown;
  previousConfidence: ConfidenceLevel;
  actorId: string;
  reason?: string;
}

/**
 * Central guardian of the platform's fundamental rule.
 *
 * Nothing in the persistence layer should write an AI-derived value without
 * going through `assertTraceable`, and nothing should overwrite a value without
 * going through `appendCorrection`.
 */
@Injectable()
export class TraceabilityService {
  /**
   * Rejects values that claim more certainty than their provenance supports.
   * This is deliberately a hard failure rather than a silent downgrade: a bug in
   * an extractor must surface in tests, not quietly ship a wrong confidence tier.
   */
  assertTraceable(
    path: string,
    confidence: ConfidenceLevel,
    sourceRefs: unknown,
  ): SourceRef[] {
    const parsed = this.normalizeSourceRefs(path, sourceRefs);
    if (confidence === ConfidenceLevel.CERTAIN && parsed.length === 0) {
      throw new BadRequestException(
        `Traceability violation at "${path}": a value cannot be "certain" without a bound source reference.`,
      );
    }
    return parsed;
  }

  /**
   * Downgrades an unbound "certain" to "deduced" instead of throwing. Used on the
   * ingestion path where a well-behaved pipeline should still not crash a whole
   * job because one field lost its binding.
   */
  coerceConfidence(confidence: ConfidenceLevel, sourceRefs: SourceRef[]): ConfidenceLevel {
    if (confidence === ConfidenceLevel.CERTAIN && sourceRefs.length === 0) {
      return ConfidenceLevel.DEDUCED;
    }
    return confidence;
  }

  normalizeSourceRefs(path: string, raw: unknown): SourceRef[] {
    if (raw === null || raw === undefined) return [];
    if (!Array.isArray(raw)) {
      throw new BadRequestException(`Source references at "${path}" must be an array.`);
    }
    return raw.map((entry, index) => {
      const result = sourceRefSchema.safeParse(entry);
      if (!result.success) {
        throw new BadRequestException(
          `Invalid source reference at "${path}[${index}]": ${result.error.issues
            .map((i) => i.message)
            .join('; ')}`,
        );
      }
      return result.data;
    });
  }

  /**
   * Appends to an existing correction log. The previous value is preserved so a
   * reviewer can always reconstruct what the AI originally proposed.
   */
  appendCorrection(existing: unknown, input: CorrectionInput): CorrectionEntry[] {
    const history = this.readHistory(existing);
    history.push({
      at: new Date().toISOString(),
      by: input.actorId,
      field: input.field,
      previousValue: input.previousValue ?? null,
      newValue: input.newValue ?? null,
      previousConfidence: input.previousConfidence,
      // A human touching a value always promotes it to the strongest tier.
      newConfidence: ConfidenceLevel.USER_CONFIRMED,
      reason: input.reason,
    });
    return history;
  }

  /** Lenient read of persisted source refs (JSON column) without validation. */
  readSourceRefs(raw: unknown): SourceRef[] {
    return Array.isArray(raw) ? (raw as SourceRef[]) : [];
  }

  readHistory(existing: unknown): CorrectionEntry[] {
    if (!Array.isArray(existing)) return [];
    return existing as CorrectionEntry[];
  }

  /** Confidence of a derived value is never stronger than its weakest input. */
  weakest(levels: ConfidenceLevel[]): ConfidenceLevel {
    if (levels.length === 0) return ConfidenceLevel.HYPOTHESIS;
    return levels.reduce((weakest, current) =>
      CONFIDENCE_WEIGHT[current] < CONFIDENCE_WEIGHT[weakest] ? current : weakest,
    );
  }

  /** Merges provenance of several inputs into the provenance of a derived value. */
  mergeSources(...groups: (SourceRef[] | undefined)[]): SourceRef[] {
    const seen = new Set<string>();
    const merged: SourceRef[] = [];
    for (const group of groups) {
      for (const ref of group ?? []) {
        // Key order differs between refs built in code and refs read back from
        // JSONB, so the identity key must be canonical.
        const key = JSON.stringify(
          Object.fromEntries(
            Object.entries(ref as Record<string, unknown>).sort(([a], [b]) =>
              a.localeCompare(b),
            ),
          ),
        );
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(ref);
        }
      }
    }
    return merged;
  }
}
