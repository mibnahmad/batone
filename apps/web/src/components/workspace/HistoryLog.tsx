import type { ReactNode } from 'react';
import type { CorrectionEntry } from '@batione/shared';
import { History } from 'lucide-react';
import { formatDate } from '../../lib/utils';

export interface HistoryLogItem {
  at?: string;
  actor?: string;
  text: ReactNode;
}

export function correctionsToItems(
  history: CorrectionEntry[],
): HistoryLogItem[] {
  return [...history]
    .reverse()
    .map((entry) => ({
      at: entry.at,
      actor: entry.by,
      text: (
        <>
          <span className="font-medium">{entry.field}</span> :{' '}
          <span className="text-red-500 line-through">
            {String(entry.previousValue ?? '—')}
          </span>{' '}
          → <span className="text-emerald-600">{String(entry.newValue ?? '—')}</span>
          {entry.reason ? ` (${entry.reason})` : ''}
        </>
      ),
    }));
}

export function HistoryLog({ items }: { items: HistoryLogItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-slate-400">
        <History size={20} className="text-slate-300" />
        Aucune modification enregistrée.
      </div>
    );
  }
  return (
    <ul className="flex h-full flex-col gap-2 overflow-y-auto p-4">
      {items.map((item, i) => (
        <li
          key={i}
          className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600"
        >
          <div>{item.text}</div>
          <div className="mt-1 text-[11px] text-slate-400">
            {item.actor ? `${item.actor} · ` : ''}
            {item.at ? formatDate(item.at) : ''}
          </div>
        </li>
      ))}
    </ul>
  );
}
