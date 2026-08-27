import { ConfidenceLevel } from '@batione/shared';
import type { ConfidenceLevel as ConfidenceLevelType } from '@batione/shared';
import { Badge } from './Badge';
import type { BadgeTone } from './Badge';

const CONFIG: Record<
  ConfidenceLevelType,
  { tone: BadgeTone; label: string }
> = {
  [ConfidenceLevel.CERTAIN]: { tone: 'green', label: 'Certain' },
  [ConfidenceLevel.DEDUCED]: { tone: 'blue', label: 'Déduit' },
  [ConfidenceLevel.HYPOTHESIS]: { tone: 'amber', label: 'Hypothèse' },
  [ConfidenceLevel.USER_CONFIRMED]: { tone: 'violet', label: 'Confirmé' },
};

export interface ConfidenceBadgeProps {
  confidence: ConfidenceLevelType;
  className?: string;
}

export function ConfidenceBadge({ confidence, className }: ConfidenceBadgeProps) {
  const cfg = CONFIG[confidence] ?? CONFIG[ConfidenceLevel.HYPOTHESIS];
  return (
    <Badge tone={cfg.tone} className={className}>
      {cfg.label}
    </Badge>
  );
}
