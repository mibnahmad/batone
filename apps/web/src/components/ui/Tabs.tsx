import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface TabItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ items, active, onChange, className }: TabsProps) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {items.map((item) => (
        <button
          key={item.id}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            active === item.id
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
