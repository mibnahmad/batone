import { BadRequestException } from '@nestjs/common';
import { ConfidenceLevel } from '@batione/shared';
import { TraceabilityService } from './traceability.service';

describe('TraceabilityService', () => {
  const service = new TraceabilityService();

  describe('assertTraceable', () => {
    it('rejects a "certain" value that has no bound source', () => {
      expect(() => service.assertTraceable('takeoff.quantity', ConfidenceLevel.CERTAIN, [])).toThrow(
        BadRequestException,
      );
    });

    it('accepts a "certain" value bound to a document region', () => {
      const refs = service.assertTraceable('takeoff.quantity', ConfidenceLevel.CERTAIN, [
        { documentId: 'doc-1', page: 2, region: [0, 0, 1, 1] as [number, number, number, number] },
      ]);
      expect(refs).toHaveLength(1);
      expect(refs[0].documentId).toBe('doc-1');
    });

    it('allows an unsourced value only in the weaker tiers', () => {
      expect(service.assertTraceable('p', ConfidenceLevel.HYPOTHESIS, [])).toEqual([]);
      expect(service.assertTraceable('p', ConfidenceLevel.DEDUCED, [])).toEqual([]);
    });

    it('rejects malformed source references', () => {
      // A ref that locates nothing (no page, region, clause or rule) is refused.
      expect(() =>
        service.assertTraceable('p', ConfidenceLevel.DEDUCED, [{ documentId: 'doc-1' }]),
      ).toThrow(BadRequestException);
      expect(() => service.assertTraceable('p', ConfidenceLevel.DEDUCED, 'doc-1')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('coerceConfidence', () => {
    it('downgrades an unbound "certain" instead of failing the job', () => {
      expect(service.coerceConfidence(ConfidenceLevel.CERTAIN, [])).toBe(
        ConfidenceLevel.DEDUCED,
      );
    });

    it('leaves a bound "certain" untouched', () => {
      expect(
        service.coerceConfidence(ConfidenceLevel.CERTAIN, [{ documentId: 'doc-1', page: 1 }]),
      ).toBe(ConfidenceLevel.CERTAIN);
    });
  });

  describe('appendCorrection', () => {
    it('appends rather than overwrites, and promotes to user_confirmed', () => {
      const first = service.appendCorrection([], {
        field: 'quantity',
        previousValue: 148.2,
        newValue: 150,
        previousConfidence: ConfidenceLevel.CERTAIN,
        actorId: 'user-1',
        reason: 'relevé chantier',
      });
      const second = service.appendCorrection(first, {
        field: 'quantity',
        previousValue: 150,
        newValue: 152,
        previousConfidence: ConfidenceLevel.USER_CONFIRMED,
        actorId: 'user-1',
      });

      expect(second).toHaveLength(2);
      expect(second[0].previousValue).toBe(148.2);
      expect(second[1].newConfidence).toBe(ConfidenceLevel.USER_CONFIRMED);
      expect(second[0].reason).toBe('relevé chantier');
    });
  });

  describe('weakest', () => {
    it('never lets a derived value be stronger than its weakest input', () => {
      expect(
        service.weakest([
          ConfidenceLevel.CERTAIN,
          ConfidenceLevel.DEDUCED,
          ConfidenceLevel.USER_CONFIRMED,
        ]),
      ).toBe(ConfidenceLevel.DEDUCED);
      expect(service.weakest([ConfidenceLevel.CERTAIN, ConfidenceLevel.HYPOTHESIS])).toBe(
        ConfidenceLevel.HYPOTHESIS,
      );
      expect(service.weakest([])).toBe(ConfidenceLevel.HYPOTHESIS);
    });
  });

  describe('mergeSources', () => {
    it('deduplicates refs regardless of key order', () => {
      const merged = service.mergeSources(
        [{ documentId: 'doc-1', page: 1 }],
        [{ page: 1, documentId: 'doc-1' } as never],
        [{ documentId: 'doc-2', page: 3 }],
        undefined,
      );
      expect(merged).toHaveLength(2);
    });
  });
});
