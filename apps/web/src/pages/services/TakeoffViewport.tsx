import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ruler } from 'lucide-react';
import { takeoffApi } from '../../lib/api';
import type { TakeoffLine } from '../../lib/types';
import { errorMessage, formatNumber } from '../../lib/utils';
import { useUIStore } from '../../store/ui';
import { useExport } from '../../hooks/useExport';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import {
  TraceableTable,
  type TraceableColumn,
} from '../../components/ui/TraceableTable';
import { ViewportLayout } from '../../components/workspace/ViewportLayout';
import { DetailPanel } from '../../components/workspace/DetailPanel';
import {
  HistoryLog,
  correctionsToItems,
} from '../../components/workspace/HistoryLog';
import { ExportMenu } from '../../components/workspace/ExportMenu';
import type { ServiceViewportProps } from './types';

export function TakeoffViewport({ projectId }: ServiceViewportProps) {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const { exportAs, exporting } = useExport(projectId, 'takeoff');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const queryKey = ['takeoff', projectId];
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => takeoffApi.get(projectId),
    retry: false,
  });

  const lines = data?.lines ?? [];
  const clauses = data?.clauses ?? [];
  const summary = data?.summary ?? [];
  const selected = lines.find((l) => l.id === selectedId) ?? null;

  const correctMutation = useMutation({
    mutationFn: ({
      lineId,
      field,
      value,
    }: {
      lineId: string;
      field: string;
      value: unknown;
    }) => takeoffApi.correct(lineId, { field, value, reason: 'Correction manuelle' }),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKey, res);
      pushToast('Quantité corrigée.', 'success');
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const columns = useMemo<TraceableColumn<TakeoffLine>[]>(
    () => [
      {
        key: 'ouvrage',
        header: 'Ouvrage',
        render: (row) => (
          <span className="font-medium text-slate-800">{row.ouvrage}</span>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        render: (row) => (
          <span className="text-slate-500">{row.description || '—'}</span>
        ),
      },
      { key: 'floor', header: 'Étage', render: (row) => row.floor },
      {
        key: 'unit',
        header: 'Unité',
        render: (row) => <Badge tone="neutral">{row.unit}</Badge>,
      },
      {
        key: 'quantity',
        header: 'Quantité',
        align: 'right',
        editable: true,
        editValue: (row) => String(row.quantity ?? ''),
        render: (row) => (
          <span className="font-semibold tabular-nums">
            {formatNumber(row.quantity)}
          </span>
        ),
      },
    ],
    [],
  );

  const detail = selected ? (
    <DetailPanel
      title={selected.ouvrage}
      subtitle={`${selected.floor} · ${selected.category}`}
      confidence={selected.confidence}
      sources={selected.sourceRefs}
      fields={[
        { label: 'Unité', value: selected.unit },
        { label: 'Quantité', value: formatNumber(selected.quantity) },
        {
          label: 'Clauses CCTP',
          value: selected.clauseIds.length
            ? selected.clauseIds
                .map((id) => {
                  const clause = clauses.find((c) => c.id === id);
                  return clause ? clause.reference || clause.title : id;
                })
                .join(' · ')
            : '—',
        },
        {
          label: 'Statut',
          value: selected.blocked ? (
            <span className="text-amber-600">En attente de clarification</span>
          ) : (
            'Validé'
          ),
        },
      ]}
      extra={
        selected.dimensions.length > 0 ? (
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">
              Dimensions
            </p>
            <ul className="space-y-1 text-xs text-slate-600">
              {selected.dimensions.map((dim, i) => (
                <li key={i}>
                  {dim.name} : {formatNumber(dim.value)} {dim.unit}
                </li>
              ))}
            </ul>
          </div>
        ) : null
      }
    />
  ) : (
    <DetailPanel />
  );

  const history = (
    <HistoryLog
      items={selected ? correctionsToItems(selected.correctionHistory) : []}
    />
  );

  const toolbar = (
    <>
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Ruler size={16} className="text-brand-600" /> Métré automatisé
      </div>
      <ExportMenu service="takeoff" onExport={exportAs} loading={exporting} />
    </>
  );

  return (
    <ViewportLayout toolbar={toolbar} detail={detail} history={history}>
      <div className="space-y-3 p-4">
        {summary.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {summary.map((row) => (
              <div
                key={row.unit}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
              >
                <span className="text-xs uppercase text-slate-400">
                  Total {row.unit}
                </span>
                <p className="font-bold tabular-nums text-slate-800">
                  {formatNumber(row.total)}
                </p>
              </div>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16 text-brand-500">
            <Spinner size="lg" />
          </div>
        ) : isError || lines.length === 0 ? (
          <EmptyState
            title="Aucune ligne de métré"
            description="Importez vos plans et lancez l'analyse pour générer le métré."
          />
        ) : (
          <TraceableTable
            rows={lines}
            columns={columns}
            getRowId={(row) => row.id}
            getConfidence={(row) => row.confidence}
            getSources={(row) => row.sourceRefs}
            getBlocked={(row) => row.blocked}
            getFloor={(row) => row.floor}
            getCategory={(row) => row.category}
            selectedRowId={selectedId}
            onSelectRow={(row) => setSelectedId(row.id)}
            onCorrect={(row, key, value) => {
              if (key === 'quantity') {
                const num = Number(value.replace(',', '.'));
                if (Number.isNaN(num)) {
                  pushToast('Valeur numérique invalide.', 'error');
                  return;
                }
                correctMutation.mutate({ lineId: row.id, field: key, value: num });
              }
            }}
            emptyTitle="Aucune ligne de métré"
          />
        )}
      </div>
    </ViewportLayout>
  );
}
