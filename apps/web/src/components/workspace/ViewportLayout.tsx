import type { ReactNode } from 'react';

export interface ViewportLayoutProps {
  toolbar?: ReactNode;
  children: ReactNode;
  detail: ReactNode;
  history: ReactNode;
}

/** Shared center+bottom layout for every service viewport. */
export function ViewportLayout({
  toolbar,
  children,
  detail,
  history,
}: ViewportLayoutProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-4 py-2">
          {toolbar}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-slate-100">{children}</div>
      <div className="grid h-56 shrink-0 grid-cols-1 border-t border-slate-200 bg-white md:grid-cols-2">
        <div className="min-h-0 overflow-hidden md:border-r md:border-slate-100">
          <div className="border-b border-slate-100 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Détail & sources
          </div>
          <div className="h-[calc(100%-30px)]">{detail}</div>
        </div>
        <div className="min-h-0 overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Historique des modifications
          </div>
          <div className="h-[calc(100%-30px)]">{history}</div>
        </div>
      </div>
    </div>
  );
}
