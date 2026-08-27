import { useState } from 'react';
import { SERVICE_DISCLAIMERS } from '@batione/shared';
import type { ServiceId } from '@batione/shared';
import { Info, X } from 'lucide-react';

export function DisclaimerBanner({ service }: { service: ServiceId }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex items-start gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
      <Info size={14} className="mt-0.5 shrink-0" />
      <p className="flex-1">{SERVICE_DISCLAIMERS[service]}</p>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-0.5 hover:bg-amber-100"
        aria-label="Masquer"
      >
        <X size={13} />
      </button>
    </div>
  );
}
