import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="text-slate-300">{icon ?? <Inbox size={36} />}</div>
      <div>
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        {description && (
          <p className="mt-1 max-w-sm text-xs text-slate-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
