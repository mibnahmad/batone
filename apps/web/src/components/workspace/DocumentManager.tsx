import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DocumentKind } from '@batione/shared';
import type { ServiceId } from '@batione/shared';
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Play,
  Plus,
  ScrollText,
  Trash2,
  Upload,
} from 'lucide-react';
import { documentsApi } from '../../lib/api';
import type { ProjectDocument } from '../../lib/types';
import { errorMessage, formatBytes } from '../../lib/utils';
import { useUIStore } from '../../store/ui';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import type { BadgeTone } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { EmptyState } from '../ui/EmptyState';

export interface DocumentManagerProps {
  projectId: string;
  service: ServiceId;
  onRun: (documentIds: string[]) => void;
  running: boolean;
}

const PARSE_TONE: Record<string, BadgeTone> = {
  pending: 'neutral',
  parsing: 'blue',
  parsed: 'green',
  failed: 'red',
};

const PARSE_LABEL: Record<string, string> = {
  pending: 'En attente',
  parsing: 'Analyse…',
  parsed: 'Analysé',
  failed: 'Échec',
};

export function DocumentManager({
  projectId,
  service,
  onRun,
  running,
}: DocumentManagerProps) {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const planInputRef = useRef<HTMLInputElement>(null);
  const cctpInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const queryKey = ['documents', projectId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => documentsApi.list(projectId),
    retry: false,
  });

  const documents = data ?? [];
  const plans = documents.filter((d) => d.kind !== DocumentKind.CCTP);
  const cctp = documents.find((d) => d.kind === DocumentKind.CCTP) ?? null;

  const byFloor = useMemo(() => {
    const groups = new Map<string, ProjectDocument[]>();
    for (const doc of [...plans].sort((a, b) => a.orderIndex - b.orderIndex)) {
      const floor = doc.floor || 'Sans étage';
      if (!groups.has(floor)) groups.set(floor, []);
      groups.get(floor)!.push(doc);
    }
    return Array.from(groups.entries());
  }, [plans]);

  const uploadMutation = useMutation({
    mutationFn: ({ file, kind }: { file: File; kind: string }) =>
      documentsApi.upload(projectId, file, { kind }),
    onMutate: () => setUploading(true),
    onSuccess: () => {
      pushToast('Document importé.', 'success');
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
    onSettled: () => setUploading(false),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, orderIndex }: { id: string; orderIndex: number }) =>
      documentsApi.patch(id, { orderIndex }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.remove(id),
    onSuccess: () => {
      pushToast('Document supprimé.', 'info');
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const handleFile = (kind: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate({ file, kind });
    e.target.value = '';
  };

  const reorder = (doc: ProjectDocument, dir: -1 | 1) => {
    const sorted = [...plans].sort((a, b) => a.orderIndex - b.orderIndex);
    const idx = sorted.findIndex((d) => d.id === doc.id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    patchMutation.mutate({ id: doc.id, orderIndex: swap.orderIndex });
    patchMutation.mutate({ id: swap.id, orderIndex: doc.orderIndex });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <h3 className="text-sm font-semibold text-slate-800">Documents</h3>
        <input
          ref={planInputRef}
          type="file"
          className="hidden"
          onChange={handleFile(DocumentKind.PLAN)}
        />
        <Button
          size="sm"
          variant="outline"
          leftIcon={<Plus size={14} />}
          loading={uploading}
          onClick={() => planInputRef.current?.click()}
        >
          Plan
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex justify-center py-6 text-slate-400">
            <Spinner />
          </div>
        ) : plans.length === 0 ? (
          <EmptyState
            icon={<Upload size={28} />}
            title="Aucun plan importé"
            description="Ajoutez vos plans pour lancer l'analyse."
          />
        ) : (
          byFloor.map(([floor, docs]) => (
            <div key={floor}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {floor}
              </p>
              <ul className="flex flex-col gap-1">
                {docs.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-2 py-1.5"
                  >
                    <FileText size={15} className="shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-700">
                        {doc.label || doc.originalName}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {doc.format.toUpperCase()} · {formatBytes(doc.sizeBytes)}
                      </p>
                    </div>
                    <Badge tone={PARSE_TONE[doc.parseStatus] ?? 'neutral'}>
                      {PARSE_LABEL[doc.parseStatus] ?? doc.parseStatus}
                    </Badge>
                    <div className="flex flex-col">
                      <button
                        onClick={() => reorder(doc, -1)}
                        className="text-slate-300 hover:text-slate-600"
                        aria-label="Monter"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        onClick={() => reorder(doc, 1)}
                        className="text-slate-300 hover:text-slate-600"
                        aria-label="Descendre"
                      >
                        <ChevronDown size={13} />
                      </button>
                    </div>
                    <button
                      onClick={() => deleteMutation.mutate(doc.id)}
                      className="text-slate-300 hover:text-red-500"
                      aria-label="Supprimer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}

        {/* CCTP card */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScrollText size={15} className="text-slate-500" />
              <p className="text-xs font-semibold text-slate-700">
                Cahier des charges (CCTP)
              </p>
            </div>
            {cctp ? (
              <Badge tone={PARSE_TONE[cctp.parseStatus] ?? 'neutral'}>
                {PARSE_LABEL[cctp.parseStatus] ?? cctp.parseStatus}
              </Badge>
            ) : (
              <Badge tone="neutral">Absent</Badge>
            )}
          </div>
          {cctp ? (
            <p className="mt-1 truncate text-[11px] text-slate-500">
              {cctp.label || cctp.originalName}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-slate-400">
              Ajoutez le CCTP pour enrichir l'analyse IA.
            </p>
          )}
          <input
            ref={cctpInputRef}
            type="file"
            className="hidden"
            onChange={handleFile(DocumentKind.CCTP)}
          />
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            leftIcon={<Plus size={13} />}
            loading={uploading}
            onClick={() => cctpInputRef.current?.click()}
          >
            {cctp ? 'Remplacer le CCTP' : 'Ajouter le CCTP'}
          </Button>
        </div>
      </div>

      <div className="border-t border-slate-100 p-3">
        <Button
          variant="primary"
          className="w-full"
          leftIcon={<Play size={15} />}
          loading={running}
          disabled={plans.length === 0}
          onClick={() => onRun(documents.map((d) => d.id))}
        >
          Lancer l'analyse
        </Button>
        <p className="mt-1 text-center text-[10px] text-slate-400">
          {service === 'price_study'
            ? 'Génère une étude de prix'
            : 'Traite les plans importés'}
        </p>
      </div>
    </div>
  );
}
