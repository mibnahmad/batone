import { Injectable } from '@nestjs/common';
import { PriceBreakdown } from '@batione/shared';
import { PriceRuleSetDefinition } from './rule-definitions';

export interface PriceCalcItem {
  id: string;
  category: string;
  quantity: number;
  unitPriceMaterials: number;
  unitPriceLabour: number;
  unitPriceEquipment: number;
}

export interface PriceCalcItemResult {
  id: string;
  totalMaterials: number;
  totalLabour: number;
  totalEquipment: number;
  total: number;
}

export interface PriceCalcOutput {
  items: PriceCalcItemResult[];
  breakdown: PriceBreakdown;
  categorySubtotals: { category: string; total: number }[];
}

/**
 * Deterministic cost engine.
 *
 * The chain is fixed and versioned: quantity × PU → coût direct → frais généraux
 * → marge → total HT → TVA → prix final. Each step is emitted with its literal
 * formula so the customer's own estimator can reproduce it.
 */
@Injectable()
export class PriceCalculator {
  compute(
    items: PriceCalcItem[],
    rules: PriceRuleSetDefinition,
    ruleId: string,
    ruleVersion: string,
  ): PriceCalcOutput {
    const results: PriceCalcItemResult[] = items.map((item) => {
      const totalMaterials = round2(item.quantity * item.unitPriceMaterials);
      const totalLabour = round2(item.quantity * item.unitPriceLabour);
      const totalEquipment = round2(item.quantity * item.unitPriceEquipment);
      return {
        id: item.id,
        totalMaterials,
        totalLabour,
        totalEquipment,
        total: round2(totalMaterials + totalLabour + totalEquipment),
      };
    });

    const materialsCost = round2(sum(results.map((r) => r.totalMaterials)));
    const labourCost = round2(sum(results.map((r) => r.totalLabour)));
    const equipmentCost = round2(sum(results.map((r) => r.totalEquipment)));
    const directCost = round2(materialsCost + labourCost + equipmentCost);

    const overheadBase = rules.overheadBase === 'labour_only' ? labourCost : directCost;
    const overheadAmount = round2(overheadBase * rules.overheadRate);
    const costAfterOverhead = round2(directCost + overheadAmount);

    // Mark-up on cost vs. margin on selling price are materially different
    // numbers; which one applies is a commercial decision held in the rule set.
    const marginAmount =
      rules.marginBase === 'selling_price'
        ? round2((costAfterOverhead / (1 - rules.marginRate)) - costAfterOverhead)
        : round2(costAfterOverhead * rules.marginRate);

    const preTaxTotal = round2(costAfterOverhead + marginAmount);
    const vatAmount = round2(preTaxTotal * rules.vatRate);
    const finalPrice = round2(preTaxTotal + vatAmount);

    const categoryMap = new Map<string, number>();
    items.forEach((item, index) => {
      const total = results[index].total;
      categoryMap.set(item.category, round2((categoryMap.get(item.category) ?? 0) + total));
    });

    const breakdown: PriceBreakdown = {
      currency: rules.currency,
      directCost,
      materialsCost,
      labourCost,
      equipmentCost,
      overheadRate: rules.overheadRate,
      overheadAmount,
      marginRate: rules.marginRate,
      marginAmount,
      preTaxTotal,
      vatRate: rules.vatRate,
      vatAmount,
      finalPrice,
      ruleId,
      ruleVersion,
      steps: [
        {
          label: 'Coût direct',
          formula: `matériaux ${materialsCost} + main d'œuvre ${labourCost} + matériel ${equipmentCost}`,
          amount: directCost,
        },
        {
          label: `Frais généraux (${pct(rules.overheadRate)})`,
          formula: `${overheadBase} × ${rules.overheadRate}${
            rules.overheadBase === 'labour_only' ? " (base main d'œuvre)" : ' (base coût direct)'
          }`,
          amount: overheadAmount,
        },
        {
          label: `Marge (${pct(rules.marginRate)})`,
          formula:
            rules.marginBase === 'selling_price'
              ? `${costAfterOverhead} / (1 - ${rules.marginRate}) - ${costAfterOverhead} (marge sur prix de vente)`
              : `${costAfterOverhead} × ${rules.marginRate} (marge sur coût)`,
          amount: marginAmount,
        },
        {
          label: 'Total HT',
          formula: `${costAfterOverhead} + ${marginAmount}`,
          amount: preTaxTotal,
        },
        {
          label: `TVA (${pct(rules.vatRate)})`,
          formula: `${preTaxTotal} × ${rules.vatRate}`,
          amount: vatAmount,
        },
        {
          label: 'Prix final TTC',
          formula: `${preTaxTotal} + ${vatAmount}`,
          amount: finalPrice,
        },
      ],
    };

    return {
      items: results,
      breakdown,
      categorySubtotals: [...categoryMap.entries()]
        .map(([category, total]) => ({ category, total }))
        .sort((a, b) => b.total - a.total),
    };
  }
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2).replace(/\.00$/, '')} %`;
}
