import { z } from 'zod';

/**
 * Rebar rule sets are BatiOne-owned, versioned and deterministic.
 *
 * The LLM never produces a bar length or a weight. It reads dimensions and
 * callouts; this definition decides what those mean. Every computed line
 * records `ruleId@ruleVersion` so an old result stays explainable after the
 * rules change.
 */

/** Nominal mass per metre (kg/m) for standard HA reinforcement bars. */
export const REBAR_UNIT_MASS: Record<number, number> = {
  6: 0.222,
  8: 0.395,
  10: 0.617,
  12: 0.888,
  14: 1.208,
  16: 1.578,
  20: 2.466,
  25: 3.853,
  32: 6.313,
  40: 9.865,
};

export const rebarElementRuleSchema = z.object({
  /** Concrete cover, metres, applied on every face. */
  coverM: z.number().nonnegative(),
  /** Hook/anchorage development expressed as a multiple of the bar diameter. */
  hookFactor: z.number().nonnegative(),
  /** Lap-splice length as a multiple of the bar diameter. */
  lapFactor: z.number().nonnegative(),
  /** Maximum bar length available on site, metres; drives splice count. */
  commercialBarLengthM: z.number().positive(),
  /** Default stirrup spacing when the drawing does not state one, metres. */
  defaultStirrupSpacingM: z.number().positive(),
  /** Waste allowance applied to total weight. */
  wasteRate: z.number().nonnegative(),
});
export type RebarElementRule = z.infer<typeof rebarElementRuleSchema>;

export const rebarRuleSetSchema = z.object({
  code: z.string(),
  label: z.string(),
  /** Per structural element type. */
  elements: z.record(rebarElementRuleSchema),
});
export type RebarRuleSetDefinition = z.infer<typeof rebarRuleSetSchema>;

const BASE: RebarElementRule = {
  coverM: 0.03,
  hookFactor: 10,
  lapFactor: 50,
  commercialBarLengthM: 12,
  defaultStirrupSpacingM: 0.2,
  wasteRate: 0.05,
};

/** Default rule set shipped with the platform, aligned with common BAEL practice. */
export const DEFAULT_REBAR_RULESET: RebarRuleSetDefinition = {
  code: 'batione-standard',
  label: 'Règles BatiOne standard (BAEL, béton courant)',
  elements: {
    semelle: { ...BASE, coverM: 0.05, hookFactor: 10 },
    poteau: { ...BASE, coverM: 0.03, hookFactor: 12, defaultStirrupSpacingM: 0.15 },
    poutre: { ...BASE, coverM: 0.03, hookFactor: 12, defaultStirrupSpacingM: 0.2 },
    longrine: { ...BASE, coverM: 0.04, hookFactor: 10 },
    chainage: { ...BASE, coverM: 0.03, hookFactor: 10, defaultStirrupSpacingM: 0.25 },
    dalle: { ...BASE, coverM: 0.025, hookFactor: 8, defaultStirrupSpacingM: 0.2 },
    escalier: { ...BASE, coverM: 0.025, hookFactor: 10, defaultStirrupSpacingM: 0.2 },
  },
};

/**
 * Price rules: overhead, margin and VAT, applied in a fixed, auditable order.
 * The order matters commercially (margin on top of overhead, VAT last) and is
 * therefore part of the versioned definition rather than code.
 */
export const priceRuleSetSchema = z.object({
  code: z.string(),
  label: z.string(),
  currency: z.string().default('EUR'),
  overheadRate: z.number().min(0).max(1),
  marginRate: z.number().min(0).max(1),
  vatRate: z.number().min(0).max(1),
  /** Whether overhead applies to labour only or to the whole direct cost. */
  overheadBase: z.enum(['direct_cost', 'labour_only']).default('direct_cost'),
  /** Whether margin is computed on cost (mark-up) or on selling price. */
  marginBase: z.enum(['cost', 'selling_price']).default('cost'),
});
export type PriceRuleSetDefinition = z.infer<typeof priceRuleSetSchema>;

export const DEFAULT_PRICE_RULESET: PriceRuleSetDefinition = {
  code: 'batione-standard',
  label: 'Formule BatiOne standard (FG 12 %, marge 8 %, TVA 20 %)',
  currency: 'EUR',
  overheadRate: 0.12,
  marginRate: 0.08,
  vatRate: 0.2,
  overheadBase: 'direct_cost',
  marginBase: 'cost',
};

/** Takeoff rules: how raw geometry becomes billable quantities. */
export const takeoffRuleSetSchema = z.object({
  code: z.string(),
  label: z.string(),
  /** Openings are deducted from wall area only above this threshold, m². */
  openingDeductionThresholdM2: z.number().nonnegative(),
  /** Assumed area of an opening when the plan does not dimension it, m². */
  defaultOpeningAreaM2: z.number().positive(),
  /** Rounding applied to published quantities. */
  quantityDecimals: z.number().int().min(0).max(4),
});
export type TakeoffRuleSetDefinition = z.infer<typeof takeoffRuleSetSchema>;

export const DEFAULT_TAKEOFF_RULESET: TakeoffRuleSetDefinition = {
  code: 'batione-standard',
  label: 'Règles de métré BatiOne standard',
  openingDeductionThresholdM2: 0.5,
  defaultOpeningAreaM2: 1.8,
  quantityDecimals: 2,
};

export const RULE_SET_VERSION = '1.0.0';
