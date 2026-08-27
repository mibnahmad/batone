import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'green'
  | 'blue'
  | 'amber'
  | 'red'
  | 'violet'
  | 'ai';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  brand: 'bg-brand-100 text-brand-800 border-brand-200',
  green: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  blue: 'bg-sky-100 text-sky-800 border-sky-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  red: 'bg-red-100 text-red-800 border-red-200',
  violet: 'bg-violet-100 text-violet-800 border-violet-200',
  ai: 'bg-ai-100 text-ai-800 border-ai-200',
};

export function Badge({ tone = 'neutral', children, className, icon }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
