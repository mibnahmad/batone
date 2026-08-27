import { useState } from 'react';
import { SERVICE_EXPORT_FORMATS } from '@batione/shared';
import type { ExportFormat, ServiceId } from '@batione/shared';
import { Download, ChevronDown } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

export interface ExportMenuProps {
  service: ServiceId;
  onExport: (format: ExportFormat) => void;
  loading?: boolean;
}

const FORMAT_LABELS: Record<string, string> = {
  xlsx: 'Excel (.xlsx)',
  pdf: 'PDF (.pdf)',
  glb: '3D — GLB (.glb)',
  gltf: '3D — glTF (.gltf)',
  obj: '3D — OBJ (.obj)',
};

export function ExportMenu({ service, onExport, loading }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const formats = SERVICE_EXPORT_FORMATS[service];

  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <Button
        variant="outline"
        size="sm"
        loading={loading}
        leftIcon={<Download size={15} />}
        rightIcon={<ChevronDown size={14} />}
        onClick={() => setOpen((v) => !v)}
      >
        Exporter
      </Button>
      {open && (
        <div
          className={cn(
            'absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl',
          )}
        >
          {formats.map((format) => (
            <button
              key={format}
              onClick={() => {
                setOpen(false);
                onExport(format);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              {FORMAT_LABELS[format] ?? format}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
