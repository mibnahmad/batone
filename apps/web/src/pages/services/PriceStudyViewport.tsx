import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfidenceLevel } from '@batione/shared';
import type { PriceBreakdown } from '@batione/shared';
import { Calculator, Download, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { priceStudyApi } from '../../lib/api';
import type { PriceItem } from '../../lib/types';
import { errorMessage, formatCurrency, formatNumber } from '../../lib/utils';
import { useUIStore } from '../../store/ui';
import { useExport } from '../../hooks/useExport';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
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

const EDITABLE_FIELDS = new Set([
  'quantity',
  'unitPriceMaterials',
  'unitPriceLabour',
  'unitPriceEquipment',
  'designation',
]);

export function PriceStudyViewport({ projectId }: ServiceViewportProps) {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const { exportAs, exporting } = useExport(projectId, 'price_study');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const queryKey = ['price_study', projectId];
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => priceStudyApi.get(projectId),
    retry: false,
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const breakdown = (data?.breakdown ?? null) as PriceBreakdown | null;
  const currency = data?.study?.currency ?? 'EUR';
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const setData = (res: unknown) => queryClient.setQueryData(queryKey, res);

  const addMutation = useMutation({
    mutationFn: () =>
      priceStudyApi.addItem(projectId, {
        designation: 'Nouveau poste',
        unit: 'u',
        category: 'divers',
        quantity: 0,
      }),
    onSuccess: (res) => {
      setData(res);
      pushToast('Ligne ajoutée.', 'success');
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const importMutation = useMutation({
    mutationFn: () => priceStudyApi.importTakeoff(projectId),
    onSuccess: (res) => {
      setData(res);
      pushToast('Métré importé dans l\'étude.', 'success');
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => priceStudyApi.removeItem(itemId),
    onSuccess: (res) => {
      setData(res);
      pushToast('Ligne supprimée.', 'info');
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const correctMutation = useMutation({
    mutationFn: ({
      itemId,
      field,
      value,
    }: {
      itemId: string;
      field: string;
      value: unknown;
    }) =>
      priceStudyApi.patchItem(itemId, {
        field,
        value,
        reason: 'Correction manuelle',
      }),
    onSuccess: (res) => setData(res),
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const subtotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      map.set(item.category, (map.get(item.category) ?? 0) + item.total);
    }
    return Array.from(map.entries());
  }, [items]);

  const hypotheses = items.filter(
    (i) => i.confidence === ConfidenceLevel.HYPOTHESIS,
  );

  const columns = useMemo<TraceableColumn<PriceItem>[]>(
    () => [
      { key: 'code', header: 'Code', render: (row) => row.code || '—' },
      {
        key: 'designation',
        header: 'Désignation',
        editable: true,
        editValue: (row) => row.designation,
        render: (row) => (
          <span className="font-medium text-slate-800">{row.designation}</span>
        ),
      },
      {
        key: 'category',
        header: 'Catégorie',
        render: (row) => <Badge tone="neutral">{row.category}</Badge>,
      },
      { key: 'unit', header: 'Unité', render: (row) => row.unit },
      {
        key: 'quantity',
        header: 'Qté',
        align: 'right',
        editable: true,
        editValue: (row) => String(row.quantity),
        render: (row) => formatNumber(row.quantity),
      },
      {
        key: 'unitPriceMaterials',
        header: 'PU Mat.',
        align: 'right',
        editable: true,
        editValue: (row) => String(row.unitPriceMaterials),
        render: (row) => formatCurrency(row.unitPriceMaterials, currency),
      },
      {
        key: 'unitPriceLabour',
        header: 'PU MO',
        align: 'right',
        editable: true,
        editValue: (row) => String(row.unitPriceLabour),
        render: (row) => formatCurrency(row.unitPriceLabour, currency),
      },
      {
        key: 'unitPriceEquipment',
        header: 'PU Matériel',
        align: 'right',
        editable: true,
        editValue: (row) => String(row.unitPriceEquipment),
        render: (row) => formatCurrency(row.unitPriceEquipment, currency),
      },
      {
        key: 'total',
        header: 'Total',
        align: 'right',
        render: (row) => (
          <span className="font-semibold tabular-nums">
            {formatCurrency(row.total, currency)}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        render: (row) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteMutation.mutate(row.id);
            }}
            className="text-slate-300 hover:text-red-500"
            aria-label="Supprimer"
          >
            <Trash2 size={14} />
          </button>
        ),
      },
    ],
    [currency, deleteMutation],
  );

  const detail = selected ? (
    <DetailPanel
      title={selected.designation}
      subtitle={`${selected.category} · ${selected.unit}`}
      confidence={selected.confidence}
      sources={selected.sourceRefs}
      fields={[
        { label: 'Quantité', value: formatNumber(selected.quantity) },
        {
          label: 'PU Matériaux',
          value: formatCurrency(selected.unitPriceMaterials, currency),
        },
        {
          label: 'PU Main d\'œuvre',
          value: formatCurrency(selected.unitPriceLabour, currency),
        },
        {
          label: 'PU Matériel',
          value: formatCurrency(selected.unitPriceEquipment, currency),
        },
        { label: 'Total', value: formatCurrency(selected.total, currency) },
      ]}
    />
  ) : (
    <DetailPanel emptyLabel="Sélectionnez une ligne de prix." />
  );

  const history = (
    <HistoryLog
      items={selected ? correctionsToItems(selected.correctionHistory) : []}
    />
  );

  const toolbar = (
    <>
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Calculator size={16} className="text-brand-600" /> Étude de prix
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          leftIcon={<Download size={14} />}
          loading={importMutation.isPending}
          onClick={() => importMutation.mutate()}
        >
          Importer le métré
        </Button>
        <Button
          size="sm"
          variant="outline"
          leftIcon={<Plus size={14} />}
          loading={addMutation.isPending}
          onClick={() => addMutation.mutate()}
        >
          Ligne
        </Button>
        <ExportMenu
          service="price_study"
          onExport={exportAs}
          loading={exporting}
        />
      </div>
    </>
  );

  return (
    <ViewportLayout toolbar={toolbar} detail={detail} history={history}>
      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {isLoading ? (
            <div className="flex justify-center py-16 text-brand-500">
              <Spinner size="lg" />
            </div>
          ) : isError || items.length === 0 ? (
            <EmptyState
              icon={<Calculator size={36} />}
              title="Aucune ligne de prix"
              description="Importez le métré ou ajoutez des lignes manuellement."
              action={
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Plus size={14} />}
                  onClick={() => addMutation.mutate()}
                >
                  Ajouter une ligne
                </Button>
              }
            />
          ) : (
            <>
              <TraceableTable
                rows={items}
                columns={columns}
                getRowId={(row) => row.id}
                getConfidence={(row) => row.confidence}
                getSources={(row) => row.sourceRefs}
                getCategory={(row) => row.category}
                selectedRowId={selectedId}
                onSelectRow={(row) => setSelectedId(row.id)}
                onCorrect={(row, key, value) => {
                  if (!EDITABLE_FIELDS.has(key)) return;
                  if (key === 'designation') {
                    correctMutation.mutate({ itemId: row.id, field: key, value });
                    return;
                  }
                  const num = Number(value.replace(',', '.'));
                  if (Number.isNaN(num)) {
                    pushToast('Valeur numérique invalide.', 'error');
                    return;
                  }
                  correctMutation.mutate({ itemId: row.id, field: key, value: num });
                }}
                emptyTitle="Aucune ligne de prix"
              />

              {subtotals.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {subtotals.map(([category, total]) => (
                    <div
                      key={category}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm"
                    >
                      <span className="text-slate-400">Sous-total {category}</span>
                      <p className="font-semibold tabular-nums text-slate-800">
                        {formatCurrency(total, currency)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Décomposition du prix" />
            <CardBody>
              {breakdown && breakdown.steps.length > 0 ? (
                <ul className="space-y-2">
                  {breakdown.steps.map((step, i) => (
                    <li
                      key={i}
                      className="flex items-start justify-between gap-2 border-b border-slate-50 pb-2 last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-700">
                          {step.label}
                        </p>
                        <code className="text-[11px] text-slate-400">
                          {step.formula}
                        </code>
                      </div>
                      <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-800">
                        {formatCurrency(step.amount, currency)}
                      </span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between pt-1">
                    <span className="text-sm font-bold text-brand-700">
                      Prix final
                    </span>
                    <span className="text-base font-bold tabular-nums text-brand-700">
                      {formatCurrency(breakdown.finalPrice, currency)}
                    </span>
                  </li>
                </ul>
              ) : (
                <p className="text-xs text-slate-400">
                  La décomposition s'affichera après le calcul du prix.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Hypothèses"
              action={
                hypotheses.length > 0 ? (
                  <Badge tone="amber" icon={<TriangleAlert size={12} />}>
                    {hypotheses.length}
                  </Badge>
                ) : null
              }
            />
            <CardBody>
              {hypotheses.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Aucune hypothèse : toutes les valeurs sont sourcées ou
                  confirmées.
                </p>
              ) : (
                <ul className="space-y-2">
                  {hypotheses.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800"
                    >
                      <p className="font-medium">{item.designation}</p>
                      <p className="text-[11px] text-amber-600">
                        {formatCurrency(item.total, currency)} — à confirmer
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </ViewportLayout>
  );
}
