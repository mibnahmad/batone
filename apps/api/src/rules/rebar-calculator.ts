import { Injectable } from '@nestjs/common';
import {
  ConfidenceLevel,
  RebarLine,
  SourceRef,
  StructuralElementType,
} from '@batione/shared';
import {
  RebarElementRule,
  RebarRuleSetDefinition,
  REBAR_UNIT_MASS,
} from './rule-definitions';

export interface RebarCalcCallout {
  raw: string;
  role: 'longitudinal' | 'transversal' | 'repartition' | 'chapeau';
  diameterMm?: number;
  count?: number;
  spacingM?: number;
  confidence: ConfidenceLevel;
  sources: SourceRef[];
}

export interface RebarCalcInput {
  reference: string;
  type: string;
  count: number;
  /** Metres. Recognised keys: length, width, height, depth, thickness. */
  dimensions: Record<string, { value: number; confidence: ConfidenceLevel; sources: SourceRef[] }>;
  callouts: RebarCalcCallout[];
}

export interface RebarCalcOutput {
  lines: RebarLine[];
  /** Fields the engine could not evaluate; the caller turns these into questions. */
  missing: { path: string; label: string }[];
}

/**
 * Deterministic reinforcement calculator.
 *
 * Every number produced here comes from arithmetic over extracted dimensions and
 * a versioned rule set — never from a language model. Each line carries the
 * literal formula used, so a quantity surveyor can audit it by hand.
 */
@Injectable()
export class RebarCalculator {
  compute(
    input: RebarCalcInput,
    ruleSet: RebarRuleSetDefinition,
    ruleSetId: string,
    ruleVersion: string,
  ): RebarCalcOutput {
    const rule =
      ruleSet.elements[input.type] ?? ruleSet.elements[StructuralElementType.POUTRE];
    const lines: RebarLine[] = [];
    const missing: { path: string; label: string }[] = [];

    const dim = (key: string) => input.dimensions[key];
    const length = dim('length');
    const width = dim('width');
    const height = dim('height');

    if (!length) {
      missing.push({
        path: `rebar.${input.reference}.length`,
        label: `longueur de ${input.reference}`,
      });
    }
    if (!width || !height) {
      missing.push({
        path: `rebar.${input.reference}.section`,
        label: `section de ${input.reference}`,
      });
    }
    if (!length || !width || !height) {
      return { lines, missing };
    }

    const ruleId = `${ruleSetId}:${input.type}`;

    for (const callout of input.callouts) {
      if (!callout.diameterMm) {
        missing.push({
          path: `rebar.${input.reference}.callout.${callout.raw}`,
          label: `diamètre de l'armature « ${callout.raw} » de ${input.reference}`,
        });
        continue;
      }

      const unitMass = REBAR_UNIT_MASS[callout.diameterMm];
      if (!unitMass) {
        missing.push({
          path: `rebar.${input.reference}.diameter.${callout.diameterMm}`,
          label: `masse linéique du Ø${callout.diameterMm} (diamètre non standard)`,
        });
        continue;
      }

      const sources = mergeSources(
        callout.sources,
        length.sources,
        width.sources,
        height.sources,
      );
      const confidence = weakest([
        callout.confidence,
        length.confidence,
        width.confidence,
        height.confidence,
      ]);

      if (callout.role === 'transversal') {
        lines.push(
          this.stirrupLine({
            input,
            rule,
            callout,
            unitMass,
            lengthM: length.value,
            widthM: width.value,
            heightM: height.value,
            ruleId,
            ruleVersion,
            confidence,
            sources,
          }),
        );
      } else {
        if (!callout.count) {
          missing.push({
            path: `rebar.${input.reference}.count.${callout.raw}`,
            label: `nombre de barres pour « ${callout.raw} » de ${input.reference}`,
          });
          continue;
        }
        lines.push(
          this.longitudinalLine({
            input,
            rule,
            callout,
            unitMass,
            lengthM: length.value,
            ruleId,
            ruleVersion,
            confidence,
            sources,
          }),
        );
      }
    }

    return { lines, missing };
  }

  /**
   * Longitudinal bars: clear length plus two hooks, plus a lap splice whenever
   * the bar exceeds the commercial length available on site.
   */
  private longitudinalLine(args: {
    input: RebarCalcInput;
    rule: RebarElementRule;
    callout: RebarCalcCallout;
    unitMass: number;
    lengthM: number;
    ruleId: string;
    ruleVersion: string;
    confidence: ConfidenceLevel;
    sources: SourceRef[];
  }): RebarLine {
    const { rule, callout, lengthM, unitMass } = args;
    const diameterM = (callout.diameterMm as number) / 1000;

    const clearLength = lengthM - 2 * rule.coverM;
    const hooks = 2 * rule.hookFactor * diameterM;
    const splices = Math.max(0, Math.ceil(clearLength / rule.commercialBarLengthM) - 1);
    const lapLength = splices * rule.lapFactor * diameterM;

    const unitLengthM = round3(clearLength + hooks + lapLength);
    const count = (callout.count as number) * args.input.count;
    const totalLengthM = round3(unitLengthM * count);
    const totalWeightKg = round3(totalLengthM * unitMass * (1 + rule.wasteRate));

    return {
      elementReference: args.input.reference,
      role: callout.role,
      diameterMm: callout.diameterMm as number,
      unitLengthM,
      count,
      totalLengthM,
      unitMassKgPerM: unitMass,
      totalWeightKg,
      ruleId: args.ruleId,
      ruleVersion: args.ruleVersion,
      computation:
        `L = (${lengthM} - 2×${rule.coverM}) + 2×${rule.hookFactor}×Ø${callout.diameterMm} ` +
        `+ ${splices} recouvrement(s)×${rule.lapFactor}×Ø = ${unitLengthM} m ; ` +
        `total = ${unitLengthM} × ${count} = ${totalLengthM} m ; ` +
        `poids = ${totalLengthM} × ${unitMass} kg/m × (1 + ${rule.wasteRate}) = ${totalWeightKg} kg`,
      sources: args.sources,
      confidence: args.confidence,
    };
  }

  /**
   * Stirrups/cadres: perimeter of the confined core plus hooks, repeated at the
   * drawing's spacing (or the rule's default when the drawing is silent).
   */
  private stirrupLine(args: {
    input: RebarCalcInput;
    rule: RebarElementRule;
    callout: RebarCalcCallout;
    unitMass: number;
    lengthM: number;
    widthM: number;
    heightM: number;
    ruleId: string;
    ruleVersion: string;
    confidence: ConfidenceLevel;
    sources: SourceRef[];
  }): RebarLine {
    const { rule, callout, lengthM, widthM, heightM, unitMass } = args;
    const diameterM = (callout.diameterMm as number) / 1000;
    const spacing = callout.spacingM ?? rule.defaultStirrupSpacingM;

    const coreWidth = widthM - 2 * rule.coverM;
    const coreHeight = heightM - 2 * rule.coverM;
    const hooks = 2 * rule.hookFactor * diameterM;
    const unitLengthM = round3(2 * (coreWidth + coreHeight) + hooks);

    const perElement = Math.max(1, Math.floor((lengthM - 2 * rule.coverM) / spacing) + 1);
    const count = perElement * args.input.count;
    const totalLengthM = round3(unitLengthM * count);
    const totalWeightKg = round3(totalLengthM * unitMass * (1 + rule.wasteRate));

    // A stirrup spacing that had to be assumed is weaker evidence than one read.
    const confidence = callout.spacingM
      ? args.confidence
      : weakest([args.confidence, ConfidenceLevel.DEDUCED]);

    return {
      elementReference: args.input.reference,
      role: callout.role,
      diameterMm: callout.diameterMm as number,
      unitLengthM,
      count,
      totalLengthM,
      unitMassKgPerM: unitMass,
      totalWeightKg,
      ruleId: args.ruleId,
      ruleVersion: args.ruleVersion,
      computation:
        `L cadre = 2×((${widthM} - 2×${rule.coverM}) + (${heightM} - 2×${rule.coverM})) ` +
        `+ 2×${rule.hookFactor}×Ø${callout.diameterMm} = ${unitLengthM} m ; ` +
        `nombre = ⌊(${lengthM} - 2×${rule.coverM}) / ${spacing}⌋ + 1 = ${perElement}` +
        (args.input.count > 1 ? ` × ${args.input.count} éléments = ${count}` : '') +
        ` ; poids = ${totalLengthM} × ${unitMass} × (1 + ${rule.wasteRate}) = ${totalWeightKg} kg` +
        (callout.spacingM ? '' : ` (espacement par défaut ${spacing} m — non coté sur la coupe)`),
      sources: args.sources,
      confidence,
    };
  }
}

const ORDER: Record<ConfidenceLevel, number> = {
  user_confirmed: 4,
  certain: 3,
  deduced: 2,
  hypothesis: 1,
};

function weakest(levels: ConfidenceLevel[]): ConfidenceLevel {
  return levels.reduce((acc, cur) => (ORDER[cur] < ORDER[acc] ? cur : acc), levels[0]);
}

function mergeSources(...groups: SourceRef[][]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const group of groups) {
    for (const ref of group ?? []) {
      const key = JSON.stringify(ref);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(ref);
      }
    }
  }
  return out;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
