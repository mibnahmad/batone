import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ConfidenceLevel, SourceRef } from '@batione/shared';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ConfidenceBadge } from './ConfidenceBadge';
import { SourceRefPopover } from './SourceRefPopover';
import { EmptyState } from './EmptyState';
import { Select } from './Select';

export interface TraceableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  editable?: boolean;
  /** Value used to populate the inline editor. */
  editValue?: (row: T) => string;
  render: (row: T) => ReactNode;
  className?: string;
}

export interface TraceableTableProps<T> {
  rows: T[];
  columns: TraceableColumn<T>[];
  getRowId: (row: T) => string;
  getConfidence: (row: T) => ConfidenceLevel;
  getSources: (row: T) => SourceRef[];
  getBlocked?: (row: T) => boolean;
  getFloor?: (row: T) => string;
  getCategory?: (row: T) => string;
  onCorrect?: (row: T, columnKey: string, value: string) => void;
  onSelectRow?: (row: T) => void;
  selectedRowId?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
}

const ALIGN = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

const ALL = '__all__';

export function TraceableTable<T>({
  rows,
  columns,
  getRowId,
  getConfidence,
  getSources,
  getBlocked,
  getFloor,
  getCategory,
  onCorrect,
  onSelectRow,
  selectedRowId,
  emptyTitle = 'Aucune donnée',
  emptyDescription,
}: TraceableTableProps<T>) {
  const [floor, setFloor] = useState<string>(ALL);
  const [category, setCategory] = useState<string>(ALL);
  const [editing, setEditing] = useState<{ rowId: string; key: string } | null>(
    null,
  );
  const [draft, setDraft] = useState('');

  const floors = useMemo(() => {
    if (!getFloor) return [];
    return Array.from(new Set(rows.map(getFloor))).sort();
  }, [rows, getFloor]);

  const categories = useMemo(() => {
    if (!getCategory) return [];
    return Array.from(new Set(rows.map(getCategory))).sort();
  }, [rows, getCategory]);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (getFloor && floor !== ALL && getFloor(row) !== floor) return false;
        if (getCategory && category !== ALL && getCategory(row) !== category)
          return false;
        return true;
      }),
    [rows, floor, category, getFloor, getCategory],
  );

  const commitEdit = (row: T, key: string) => {
    if (onCorrect) onCorrect(row, key, draft);
    setEditing(null);
    setDraft('');
  };

  const hasFilters = Boolean(getFloor || getCategory);

  return (
    <div className="flex flex-col gap-3">
      {hasFilters && (
        <div className="flex flex-wrap items-end gap-3">
          {getFloor && floors.length > 0 && (
            <div className="w-40">
              <Select
                label="Étage"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                options={[
                  { value: ALL, label: 'Tous les étages' },
                  ...floors.map((f) => ({ value: f, label: f })),
                ]}
              />
            </div>
          )}
          {getCategory && categories.length > 0 && (
            <div className="w-48">
              <Select
                label="Catégorie"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                options={[
                  { value: ALL, label: 'Toutes les catégories' },
                  ...categories.map((c) => ({ value: c, label: c })),
                ]}
              />
            </div>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      'whitespace-nowrap px-3 py-2 font-semibold',
                      ALIGN[col.align ?? 'left'],
                    )}
                  >
                    {col.header}
                  </th>
                ))}
                <th className="px-3 py-2 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const rowId = getRowId(row);
                const blocked = getBlocked?.(row) ?? false;
                const selected = selectedRowId === rowId;
                return (
                  <tr
                    key={rowId}
                    onClick={() => onSelectRow?.(row)}
                    className={cn(
                      'border-t border-slate-100 transition-colors',
                      onSelectRow && 'cursor-pointer',
                      selected
                        ? 'bg-brand-50'
                        : blocked
                          ? 'bg-amber-50/60 hover:bg-amber-50'
                          : 'hover:bg-slate-50',
                    )}
                  >
                    {columns.map((col) => {
                      const isEditing =
                        editing?.rowId === rowId && editing.key === col.key;
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            'px-3 py-2 align-top',
                            ALIGN[col.align ?? 'left'],
                            col.className,
                          )}
                          onDoubleClick={
                            col.editable && onCorrect
                              ? (e) => {
                                  e.stopPropagation();
                                  setEditing({ rowId, key: col.key });
                                  setDraft(
                                    col.editValue
                                      ? col.editValue(row)
                                      : String(col.render(row) ?? ''),
                                  );
                                }
                              : undefined
                          }
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              value={draft}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={() => commitEdit(row, col.key)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitEdit(row, col.key);
                                if (e.key === 'Escape') {
                                  setEditing(null);
                                  setDraft('');
                                }
                              }}
                              className="h-8 w-full rounded border border-brand-400 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                            />
                          ) : (
                            <span
                              className={cn(
                                col.editable &&
                                  onCorrect &&
                                  'cursor-text rounded px-1 hover:bg-brand-100/50',
                              )}
                              title={
                                col.editable && onCorrect
                                  ? 'Double-cliquez pour corriger'
                                  : undefined
                              }
                            >
                              {col.render(row)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col items-start gap-1">
                        <ConfidenceBadge confidence={getConfidence(row)} />
                        <SourceRefPopover sources={getSources(row)} />
                        {blocked && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                            <AlertTriangle size={11} /> En attente de clarification
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
