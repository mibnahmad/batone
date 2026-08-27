import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Grid3x3, RefreshCw } from 'lucide-react';
import { rebarApi } from '../../lib/api';
import type { RebarLineEntity, StructuralElement } from '../../lib/types';
import { errorMessage, formatNumber } from '../../lib/utils';
import { useUIStore } from '../../store/ui';
import { useExport } from '../../hooks/useExport';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfidenceBadge } from '../../components/ui/ConfidenceBadge';
import { SourceRefPopover } from '../../components/ui/SourceRefPopover';
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

function dimensionSummary(el: StructuralElement): string {
  const entries = Object.entries(el.dimensions ?? {});
  if (entries.length === 0) return '—';
  return entries
    .map(([name, dim]) => `${name}=${formatNumber(dim.value)}m`)
    .join(' · ');
}

export function RebarViewport({ projectId }: ServiceViewportProps) {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const { exportAs, exporting } = useExport(projectId, 'rebar');
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedRebar, setSelectedRebar] = useState<RebarLineEntity | null>(null);

  const queryKey = ['rebar', projectId];
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => rebarApi.get(projectId),
    retry: false,
  });

  const elements = useMemo(() => data?.elements ?? [], [data]);
  const lines = useMemo(() => data?.lines ?? [], [data]);
  const totals = data?.totals ?? { byDiameter: [], grandTotalWeightKg: 0 };
  const selectedElement =
    elements.find((e) => e.id === selectedElementId) ?? null;

  const recomputeMutation = useMutation({
    mutationFn: () => rebarApi.recompute(projectId),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKey, res);
      pushToast('Ferraillage recalculé.', 'success');
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const correctMutation = useMutation({
    mutationFn: ({
      elementId,
      field,
      value,
    }: {
      elementId: string;
      field: string;
      value: unknown;
    }) =>
      rebarApi.patchElement(elementId, {
        field,
        value,
        reason: 'Correction manuelle',
      }),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKey, res);
      pushToast('Élément corrigé.', 'success');
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const elementColumns = useMemo<TraceableColumn<StructuralElement>[]>(
    () => [
      {
        key: 'reference',
        header: 'Référence',
        render: (row) => (
          <span className="font-medium text-slate-800">{row.reference}</span>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        render: (row) => <Badge tone="neutral">{row.type}</Badge>,
      },
      { key: 'floor', header: 'Étage', render: (row) => row.floor },
      {
        key: 'count',
        header: 'Nb',
        align: 'right',
        editable: true,
        editValue: (row) => String(row.count),
        render: (row) => row.count,
      },
      {
        key: 'dimensions',
        header: 'Dimensions',
        render: (row) => (
          <span className="text-xs text-slate-500">{dimensionSummary(row)}</span>
        ),
      },
    ],
    [],
  );

  const linesByElement = useMemo(() => {
    const byRef = new Map<string, RebarLineEntity[]>();
    for (const line of lines) {
      const el = elements.find((e) => e.id === line.structuralElementId);
      const key = el?.reference ?? line.structuralElementId;
      if (!byRef.has(key)) byRef.set(key, []);
      byRef.get(key)!.push(line);
    }
    return Array.from(byRef.entries());
  }, [lines, elements]);

  const detail = selectedRebar ? (
    <DetailPanel
      title={`Acier Ø${selectedRebar.diameterMm} — ${selectedRebar.role}`}
      subtitle={`Règle ${selectedRebar.ruleId}@${selectedRebar.ruleVersion}`}
      confidence={selectedRebar.confidence}
      sources={selectedRebar.sourceRefs}
      fields={[
        { label: 'Nombre', value: selectedRebar.count },
        {
          label: 'Long. unitaire',
          value: `${formatNumber(selectedRebar.unitLengthM)} m`,
        },
        {
          label: 'Long. totale',
          value: `${formatNumber(selectedRebar.totalLengthM)} m`,
        },
        {
          label: 'Poids total',
          value: `${formatNumber(selectedRebar.totalWeightKg)} kg`,
        },
      ]}
      extra={
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">
            Calcul (traçabilité)
          </p>
          <code className="block rounded bg-slate-900 px-2 py-1.5 text-[11px] text-emerald-300">
            {selectedRebar.computation}
          </code>
        </div>
      }
    />
  ) : selectedElement ? (
    <DetailPanel
      title={selectedElement.reference}
      subtitle={`${selectedElement.type} · ${selectedElement.floor}`}
      confidence={selectedElement.confidence}
      sources={selectedElement.sourceRefs}
      fields={[
        { label: 'Nombre', value: selectedElement.count },
        { label: 'Dimensions', value: dimensionSummary(selectedElement) },
        {
          label: 'Statut',
          value: selectedElement.blocked ? (
            <span className="text-amber-600">En attente de clarification</span>
          ) : (
            'Validé'
          ),
        },
      ]}
    />
  ) : (
    <DetailPanel emptyLabel="Sélectionnez un élément ou une ligne d'acier." />
  );

  const history = (
    <HistoryLog
      items={
        selectedElement
          ? correctionsToItems(selectedElement.correctionHistory)
          : []
      }
    />
  );

  const toolbar = (
    <>
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Grid3x3 size={16} className="text-brand-600" /> Métré ferraillage
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          leftIcon={<RefreshCw size={14} />}
          loading={recomputeMutation.isPending}
          onClick={() => recomputeMutation.mutate()}
        >
          Recalculer
        </Button>
        <ExportMenu service="rebar" onExport={exportAs} loading={exporting} />
      </div>
    </>
  );

  return (
    <ViewportLayout toolbar={toolbar} detail={detail} history={history}>
      <div className="space-y-5 p-4">
        {isLoading ? (
          <div className="flex justify-center py-16 text-brand-500">
            <Spinner size="lg" />
          </div>
        ) : isError || (elements.length === 0 && lines.length === 0) ? (
          <EmptyState
            icon={<Grid3x3 size={36} />}
            title="Aucun ferraillage"
            description="Importez les coupes et lancez l'analyse pour calculer les aciers."
          />
        ) : (
          <>
            {totals.byDiameter.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {totals.byDiameter.map((t) => (
                  <div
                    key={t.diameterMm}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
                  >
                    <span className="text-xs uppercase text-slate-400">
                      Ø{t.diameterMm}
                    </span>
                    <p className="font-bold tabular-nums text-slate-800">
                      {formatNumber(t.totalWeightKg)} kg
                    </p>
                  </div>
                ))}
                <div className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm">
                  <span className="text-xs uppercase text-brand-600">
                    Poids total
                  </span>
                  <p className="font-bold tabular-nums text-brand-800">
                    {formatNumber(totals.grandTotalWeightKg)} kg
                  </p>
                </div>
              </div>
            )}

            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                Éléments structurels
              </h3>
              <TraceableTable
                rows={elements}
                columns={elementColumns}
                getRowId={(row) => row.id}
                getConfidence={(row) => row.confidence}
                getSources={(row) => row.sourceRefs}
                getBlocked={(row) => row.blocked}
                getFloor={(row) => row.floor}
                selectedRowId={selectedElementId}
                onSelectRow={(row) => {
                  setSelectedElementId(row.id);
                  setSelectedRebar(null);
                }}
                onCorrect={(row, key, value) => {
                  if (key === 'count') {
                    const num = Number(value);
                    if (!Number.isInteger(num) || num < 1) {
                      pushToast('Nombre entier positif requis.', 'error');
                      return;
                    }
                    correctMutation.mutate({
                      elementId: row.id,
                      field: key,
                      value: num,
                    });
                  }
                }}
                emptyTitle="Aucun élément structurel"
              />
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                Lignes d'armatures
              </h3>
              {linesByElement.length === 0 ? (
                <EmptyState title="Aucune ligne d'acier calculée" />
              ) : (
                <div className="space-y-3">
                  {linesByElement.map(([ref, group]) => (
                    <div
                      key={ref}
                      className="overflow-hidden rounded-xl border border-slate-200"
                    >
                      <div className="bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                        {ref}
                      </div>
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase text-slate-400">
                            <th className="px-3 py-1.5">Rôle</th>
                            <th className="px-3 py-1.5">Ø</th>
                            <th className="px-3 py-1.5 text-right">L. unit.</th>
                            <th className="px-3 py-1.5 text-right">Nb</th>
                            <th className="px-3 py-1.5 text-right">L. totale</th>
                            <th className="px-3 py-1.5 text-right">Poids</th>
                            <th className="px-3 py-1.5">Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.map((line) => (
                            <tr
                              key={line.id}
                              onClick={() => {
                                setSelectedRebar(line);
                                setSelectedElementId(null);
                              }}
                              className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                                selectedRebar?.id === line.id ? 'bg-brand-50' : ''
                              }`}
                            >
                              <td className="px-3 py-1.5">{line.role}</td>
                              <td className="px-3 py-1.5">Ø{line.diameterMm}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {formatNumber(line.unitLengthM)} m
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {line.count}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {formatNumber(line.totalLengthM)} m
                              </td>
                              <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                                {formatNumber(line.totalWeightKg)} kg
                              </td>
                              <td className="px-3 py-1.5">
                                <div className="flex items-center gap-1">
                                  <ConfidenceBadge confidence={line.confidence} />
                                  <SourceRefPopover sources={line.sourceRefs} />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </ViewportLayout>
  );
}
