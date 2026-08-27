import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X, AlertTriangle } from 'lucide-react';
import { useUIStore } from '../../store/ui';
import type { Toast } from '../../store/ui';

const ICONS = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
};

const STYLES: Record<Toast['variant'], string> = {
  info: 'border-slate-200 bg-white text-slate-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUIStore((s) => s.dismissToast);
  const Icon = ICONS[toast.variant];
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), 5000);
    return () => clearTimeout(t);
  }, [toast.id, dismiss]);
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${STYLES[toast.variant]}`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={() => dismiss(toast.id)}
        className="text-current/60 hover:text-current"
        aria-label="Fermer"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useUIStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} />
        </div>
      ))}
    </div>
  );
}
