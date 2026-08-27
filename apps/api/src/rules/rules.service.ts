import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  DEFAULT_PRICE_RULESET,
  DEFAULT_REBAR_RULESET,
  DEFAULT_TAKEOFF_RULESET,
  PriceRuleSetDefinition,
  priceRuleSetSchema,
  RebarRuleSetDefinition,
  rebarRuleSetSchema,
  RULE_SET_VERSION,
  TakeoffRuleSetDefinition,
  takeoffRuleSetSchema,
} from './rule-definitions';

export type RuleDomain = 'rebar' | 'price' | 'takeoff';

export interface ResolvedRuleSet<T> {
  id: string;
  key: string;
  version: string;
  label: string;
  definition: T;
}

/**
 * Loads versioned rule sets, preferring an organization's own override over the
 * BatiOne default. Results are cached because rule sets are immutable: a change
 * publishes a new version rather than mutating an existing one.
 */
@Injectable()
export class RulesService implements OnModuleInit {
  private readonly cache = new Map<string, ResolvedRuleSet<unknown>>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureDefaults();
  }

  /** Idempotently publishes the shipped default rule sets. */
  async ensureDefaults(): Promise<void> {
    const defaults: {
      domain: RuleDomain;
      key: string;
      label: string;
      definition: unknown;
    }[] = [
      {
        domain: 'rebar',
        key: DEFAULT_REBAR_RULESET.code,
        label: DEFAULT_REBAR_RULESET.label,
        definition: DEFAULT_REBAR_RULESET,
      },
      {
        domain: 'price',
        key: DEFAULT_PRICE_RULESET.code,
        label: DEFAULT_PRICE_RULESET.label,
        definition: DEFAULT_PRICE_RULESET,
      },
      {
        domain: 'takeoff',
        key: DEFAULT_TAKEOFF_RULESET.code,
        label: DEFAULT_TAKEOFF_RULESET.label,
        definition: DEFAULT_TAKEOFF_RULESET,
      },
    ];

    for (const entry of defaults) {
      const existing = await this.prisma.ruleSet.findFirst({
        where: {
          domain: entry.domain,
          key: entry.key,
          version: RULE_SET_VERSION,
          organizationId: null,
        },
      });
      if (existing) continue;
      await this.prisma.ruleSet.create({
        data: {
          organizationId: null,
          domain: entry.domain,
          key: entry.key,
          version: RULE_SET_VERSION,
          label: entry.label,
          definition: entry.definition as never,
          isDefault: true,
        },
      });
    }
  }

  async listForOrganization(organizationId: string, domain?: RuleDomain) {
    return this.prisma.ruleSet.findMany({
      where: {
        ...(domain ? { domain } : {}),
        OR: [{ organizationId: null }, { organizationId }],
      },
      orderBy: [{ domain: 'asc' }, { version: 'desc' }],
    });
  }

  async rebarRules(
    organizationId: string,
    ruleSetId?: string | null,
  ): Promise<ResolvedRuleSet<RebarRuleSetDefinition>> {
    return this.resolve('rebar', organizationId, ruleSetId, rebarRuleSetSchema.parse, DEFAULT_REBAR_RULESET);
  }

  async priceRules(
    organizationId: string,
    ruleSetId?: string | null,
  ): Promise<ResolvedRuleSet<PriceRuleSetDefinition>> {
    return this.resolve('price', organizationId, ruleSetId, priceRuleSetSchema.parse, DEFAULT_PRICE_RULESET);
  }

  async takeoffRules(
    organizationId: string,
    ruleSetId?: string | null,
  ): Promise<ResolvedRuleSet<TakeoffRuleSetDefinition>> {
    return this.resolve(
      'takeoff',
      organizationId,
      ruleSetId,
      takeoffRuleSetSchema.parse,
      DEFAULT_TAKEOFF_RULESET,
    );
  }

  private async resolve<T>(
    domain: RuleDomain,
    organizationId: string,
    ruleSetId: string | null | undefined,
    parse: (value: unknown) => T,
    fallback: T,
  ): Promise<ResolvedRuleSet<T>> {
    const cacheKey = `${domain}:${organizationId}:${ruleSetId ?? 'default'}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached as ResolvedRuleSet<T>;

    const row = ruleSetId
      ? await this.prisma.ruleSet.findFirst({
          where: {
            id: ruleSetId,
            OR: [{ organizationId: null }, { organizationId }],
          },
        })
      : await this.prisma.ruleSet.findFirst({
          where: { domain, organizationId },
          orderBy: { createdAt: 'desc' },
        }) ??
        (await this.prisma.ruleSet.findFirst({
          where: { domain, organizationId: null, isDefault: true },
          orderBy: { createdAt: 'desc' },
        }));

    const resolved: ResolvedRuleSet<T> = row
      ? {
          id: row.id,
          key: row.key,
          version: row.version,
          label: row.label,
          definition: parse(row.definition),
        }
      : {
          id: `${domain}-builtin`,
          key: 'batione-standard',
          version: RULE_SET_VERSION,
          label: 'Règles intégrées',
          definition: fallback,
        };

    this.cache.set(cacheKey, resolved as ResolvedRuleSet<unknown>);
    return resolved;
  }
}
