import { PriceCalculator } from './price-calculator';
import { DEFAULT_PRICE_RULESET, RULE_SET_VERSION } from './rule-definitions';

describe('PriceCalculator', () => {
  const calculator = new PriceCalculator();

  const compute = (items: Parameters<PriceCalculator['compute']>[0]) =>
    calculator.compute(items, DEFAULT_PRICE_RULESET, 'ruleset-test', RULE_SET_VERSION);

  it('applies the fixed chain quantity × PU → direct → overhead → margin → VAT', () => {
    const out = compute([
      {
        id: 'a',
        category: 'gros_oeuvre',
        quantity: 10,
        unitPriceMaterials: 100,
        unitPriceLabour: 50,
        unitPriceEquipment: 0,
      },
    ]);

    expect(out.items[0].total).toBe(1500);

    const direct = out.breakdown.directCost;
    expect(direct).toBe(1500);

    const overhead = round2(direct * DEFAULT_PRICE_RULESET.overheadRate);
    const margin = round2((direct + overhead) * DEFAULT_PRICE_RULESET.marginRate);
    const beforeTax = round2(direct + overhead + margin);

    expect(out.breakdown.overheadAmount).toBe(overhead);
    expect(out.breakdown.marginAmount).toBe(margin);
    expect(out.breakdown.preTaxTotal).toBe(beforeTax);
    expect(out.breakdown.vatAmount).toBe(round2(beforeTax * DEFAULT_PRICE_RULESET.vatRate));
    expect(out.breakdown.finalPrice).toBe(
      round2(beforeTax + round2(beforeTax * DEFAULT_PRICE_RULESET.vatRate)),
    );
  });

  it('stamps the rule set version and emits an auditable formula per step', () => {
    const out = compute([
      {
        id: 'a',
        category: 'gros_oeuvre',
        quantity: 2,
        unitPriceMaterials: 10,
        unitPriceLabour: 0,
        unitPriceEquipment: 0,
      },
    ]);

    expect(out.breakdown.ruleVersion).toBe(RULE_SET_VERSION);
    expect(out.breakdown.steps.length).toBeGreaterThanOrEqual(5);
    for (const step of out.breakdown.steps) {
      expect(step.formula.trim().length).toBeGreaterThan(0);
    }
  });

  it('groups subtotals per category', () => {
    const out = compute([
      {
        id: 'a',
        category: 'gros_oeuvre',
        quantity: 1,
        unitPriceMaterials: 100,
        unitPriceLabour: 0,
        unitPriceEquipment: 0,
      },
      {
        id: 'b',
        category: 'gros_oeuvre',
        quantity: 1,
        unitPriceMaterials: 50,
        unitPriceLabour: 0,
        unitPriceEquipment: 0,
      },
      {
        id: 'c',
        category: 'finitions',
        quantity: 1,
        unitPriceMaterials: 25,
        unitPriceLabour: 0,
        unitPriceEquipment: 0,
      },
    ]);

    expect(out.categorySubtotals).toEqual(
      expect.arrayContaining([
        { category: 'gros_oeuvre', total: 150 },
        { category: 'finitions', total: 25 },
      ]),
    );
  });

  it('is a pure function of its inputs — same input, same price', () => {
    const items = [
      {
        id: 'a',
        category: 'gros_oeuvre',
        quantity: 3.7,
        unitPriceMaterials: 12.34,
        unitPriceLabour: 7.5,
        unitPriceEquipment: 1.1,
      },
    ];
    expect(compute(items).breakdown.finalPrice).toBe(compute(items).breakdown.finalPrice);
  });
});

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
