import type { EntitlementView } from '@batione/shared';
import { cn } from '../../lib/utils';

export interface QuotaBarProps {
  entitlement: EntitlementView | null | undefined;
  className?: string;
  compact?: boolean;
}

export function QuotaBar({ entitlement, className, compact }: QuotaBarProps) {
  if (!entitlement) {
    return (
      <div className={cn('text-xs text-slate-400', className)}>
        Aucun droit d'usage
      </div>
    );
  }

  const { quotaTotal, quotaUsed, unit } = entitlement;
  const total = quotaTotal || 0;
  const used = quotaUsed || 0;
  const ratio = total > 0 ? Math.min(used / total, 1) : used > 0 ? 1 : 0;
  const pct = Math.round(ratio * 100);
  const exhausted = entitlement.status === 'exhausted' || (total > 0 && used >= total);
  const warning = !exhausted && ratio >= 0.8;

  const barColor = exhausted
    ? 'bg-red-500'
    : warning
      ? 'bg-amber-500'
      : 'bg-brand-500';
  const textColor = exhausted
    ? 'text-red-600'
    : warning
      ? 'text-amber-600'
      : 'text-slate-600';

  return (
    <div className={cn('min-w-[160px]', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-xs font-medium', textColor)}>
          Plans utilisés : {used}/{total}
          {compact ? '' : ` ${unit}`}
        </span>
        {exhausted && (
          <span className="rounded bg-red-100 px-1.5 text-[10px] font-semibold uppercase text-red-700">
            Épuisé
          </span>
        )}
        {warning && (
          <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold uppercase text-amber-700">
            Bientôt épuisé
          </span>
        )}
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
