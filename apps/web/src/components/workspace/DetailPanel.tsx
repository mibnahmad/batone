import type { ReactNode } from 'react';
import type { ConfidenceLevel, SourceRef } from '@batione/shared';
import { MousePointerClick } from 'lucide-react';
import { ConfidenceBadge } from '../ui/ConfidenceBadge';
import { SourceRefPopover } from '../ui/SourceRefPopover';

export interface DetailField {
  label: string;
  value: ReactNode;
}

export interface DetailPanelProps {
  title?: string;
  subtitle?: string;
  confidence?: ConfidenceLevel;
  sources?: SourceRef[];
  fields?: DetailField[];
  extra?: ReactNode;
  emptyLabel?: string;
}

export function DetailPanel({
  title,
  subtitle,
  confidence,
  sources,
  fields = [],
  extra,
  emptyLabel = 'Sélectionnez un élément pour voir son détail et ses sources.',
}: DetailPanelProps) {
  if (!title) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-slate-400">
        <MousePointerClick size={22} className="text-slate-300" />
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div>
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
          {confidence && <ConfidenceBadge confidence={confidence} />}
        </div>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>

      {sources && (
        <div>
          <SourceRefPopover sources={sources} label="Voir les sources" />
        </div>
      )}

      {fields.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {fields.map((field, i) => (
            <div key={i} className="flex flex-col">
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                {field.label}
              </dt>
              <dd className="text-sm text-slate-700">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {extra}
    </div>
  );
}
