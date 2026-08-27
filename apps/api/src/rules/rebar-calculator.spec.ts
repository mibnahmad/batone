import { ConfidenceLevel } from '@batione/shared';
import { RebarCalculator, type RebarCalcInput } from './rebar-calculator';
import { DEFAULT_REBAR_RULESET, RULE_SET_VERSION } from './rule-definitions';

const source = [{ documentId: 'doc-1', page: 1 }];

function element(overrides: Partial<RebarCalcInput> = {}): RebarCalcInput {
  return {
    reference: 'PT1',
    type: 'poutre',
    count: 1,
    dimensions: {
      length: { value: 5, confidence: ConfidenceLevel.CERTAIN, sources: source },
      width: { value: 0.25, confidence: ConfidenceLevel.CERTAIN, sources: source },
      height: { value: 0.5, confidence: ConfidenceLevel.CERTAIN, sources: source },
    },
    callouts: [
      {
        raw: '6 HA14',
        role: 'longitudinal',
        diameterMm: 14,
        count: 6,
        confidence: ConfidenceLevel.CERTAIN,
        sources: source,
      },
    ],
    ...overrides,
  };
}

describe('RebarCalculator', () => {
  const calculator = new RebarCalculator();
  const compute = (input: RebarCalcInput) =>
    calculator.compute(input, DEFAULT_REBAR_RULESET, 'ruleset-test', RULE_SET_VERSION);

  it('computes longitudinal bars from the versioned rule, not from free text', () => {
    const { lines, missing } = compute(element());

    expect(missing).toHaveLength(0);
    expect(lines).toHaveLength(1);

    const rule = DEFAULT_REBAR_RULESET.elements.poutre;
    const expectedUnit = 5 - 2 * rule.coverM + 2 * rule.hookFactor * 0.014;
    expect(lines[0].unitLengthM).toBeCloseTo(expectedUnit, 3);
    expect(lines[0].count).toBe(6);
    expect(lines[0].totalWeightKg).toBeCloseTo(
      lines[0].totalLengthM * lines[0].unitMassKgPerM * (1 + rule.wasteRate),
      2,
    );
    expect(lines[0].ruleVersion).toBe(RULE_SET_VERSION);
    expect(lines[0].computation).toContain('poids =');
  });

  it('multiplies by the number of identical elements', () => {
    const single = compute(element()).lines[0];
    const triple = compute(element({ count: 3 })).lines[0];
    expect(triple.count).toBe(single.count * 3);
    expect(triple.totalWeightKg).toBeCloseTo(single.totalWeightKg * 3, 2);
  });

  it('reports a missing dimension instead of assuming one', () => {
    const input = element();
    delete input.dimensions.height;

    const { lines, missing } = compute(input);
    expect(lines).toHaveLength(0);
    expect(missing.map((m) => m.path)).toContain('rebar.PT1.section');
  });

  it('reports a missing bar count instead of inventing one', () => {
    const { lines, missing } = compute(
      element({
        callouts: [
          {
            raw: 'HA14',
            role: 'longitudinal',
            diameterMm: 14,
            confidence: ConfidenceLevel.CERTAIN,
            sources: source,
          },
        ],
      }),
    );
    expect(lines).toHaveLength(0);
    expect(missing[0].path).toBe('rebar.PT1.count.HA14');
  });

  it('downgrades a stirrup whose spacing had to come from the rule set', () => {
    const withoutSpacing = compute(
      element({
        callouts: [
          {
            raw: 'cadres HA8',
            role: 'transversal',
            diameterMm: 8,
            confidence: ConfidenceLevel.CERTAIN,
            sources: source,
          },
        ],
      }),
    ).lines[0];

    const withSpacing = compute(
      element({
        callouts: [
          {
            raw: 'cadres HA8 e=15',
            role: 'transversal',
            diameterMm: 8,
            spacingM: 0.15,
            confidence: ConfidenceLevel.CERTAIN,
            sources: source,
          },
        ],
      }),
    ).lines[0];

    expect(withoutSpacing.confidence).toBe(ConfidenceLevel.DEDUCED);
    expect(withSpacing.confidence).toBe(ConfidenceLevel.CERTAIN);
    expect(withSpacing.count).toBeGreaterThan(withoutSpacing.count);
  });

  it('refuses a non-standard diameter rather than guessing its unit mass', () => {
    const { lines, missing } = compute(
      element({
        callouts: [
          {
            raw: '4 HA9',
            role: 'longitudinal',
            diameterMm: 9,
            count: 4,
            confidence: ConfidenceLevel.CERTAIN,
            sources: source,
          },
        ],
      }),
    );
    expect(lines).toHaveLength(0);
    expect(missing[0].path).toBe('rebar.PT1.diameter.9');
  });

  it('propagates the weakest confidence of the inputs to the result', () => {
    const input = element();
    input.dimensions.length.confidence = ConfidenceLevel.HYPOTHESIS;
    expect(compute(input).lines[0].confidence).toBe(ConfidenceLevel.HYPOTHESIS);
  });

  it('always binds at least one source to every produced line', () => {
    for (const line of compute(element()).lines) {
      expect(line.sources.length).toBeGreaterThan(0);
    }
  });
});
