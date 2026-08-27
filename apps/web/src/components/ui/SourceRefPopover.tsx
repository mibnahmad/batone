import { useState } from 'react';
import type { SourceRef } from '@batione/shared';
import { FileSearch, MapPin, Ruler, ScrollText } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SourceRefPopoverProps {
  sources: SourceRef[];
  className?: string;
  label?: string;
}

/** The "d'où vient ce chiffre ?" affordance. */
export function SourceRefPopover({
  sources,
  className,
  label,
}: SourceRefPopoverProps) {
  const [open, setOpen] = useState(false);
  const count = sources.length;

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors',
          count > 0
            ? 'text-ai-700 hover:bg-ai-50'
            : 'text-slate-400 hover:bg-slate-100',
        )}
        title="D'où vient ce chiffre ?"
      >
        <FileSearch size={13} />
        {label ?? (count > 0 ? `${count} source${count > 1 ? 's' : ''}` : 'Source ?')}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <p className="mb-2 text-xs font-semibold text-slate-700">
            D'où vient ce chiffre ?
          </p>
          {count === 0 ? (
            <p className="text-xs text-slate-500">
              Aucune source liée à cette valeur.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sources.map((src, idx) => (
                <li
                  key={idx}
                  className="rounded-lg border border-slate-100 bg-slate-50 p-2"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                    {src.documentId && (
                      <span className="inline-flex items-center gap-1">
                        <ScrollText size={11} /> Doc {src.documentId.slice(0, 8)}
                      </span>
                    )}
                    {src.page && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={11} /> Page {src.page}
                      </span>
                    )}
                    {src.clauseId && (
                      <span className="inline-flex items-center gap-1">
                        <ScrollText size={11} /> Clause {src.clauseId}
                      </span>
                    )}
                    {src.ruleId && (
                      <span className="inline-flex items-center gap-1">
                        <Ruler size={11} /> Règle {src.ruleId}
                        {src.ruleVersion ? `@${src.ruleVersion}` : ''}
                      </span>
                    )}
                  </div>
                  {src.excerpt && (
                    <p className="mt-1 border-l-2 border-ai-300 pl-2 text-[11px] italic text-slate-600">
                      « {src.excerpt} »
                    </p>
                  )}
                  {src.note && (
                    <p className="mt-1 text-[11px] text-slate-500">{src.note}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
