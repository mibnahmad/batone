import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { Boxes, Redo2, Undo2 } from 'lucide-react';
import { model3dApi } from '../../lib/api';
import type { Element3DEntity } from '../../lib/types';
import { errorMessage } from '../../lib/utils';
import { useUIStore } from '../../store/ui';
import { useExport } from '../../hooks/useExport';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';
import { Tabs } from '../../components/ui/Tabs';
import { ViewportLayout } from '../../components/workspace/ViewportLayout';
import { DetailPanel } from '../../components/workspace/DetailPanel';
import { HistoryLog } from '../../components/workspace/HistoryLog';
import type { HistoryLogItem } from '../../components/workspace/HistoryLog';
import { ExportMenu } from '../../components/workspace/ExportMenu';
import type { ServiceViewportProps } from './types';

const TYPE_COLORS: Record<string, string> = {
  wall: '#94a3b8',
  door: '#f59e0b',
  window: '#38bdf8',
  slab: '#64748b',
  roof: '#b91c1c',
  stair: '#a855f7',
  column: '#475569',
  beam: '#0ea5e9',
  space: '#bbf7d0',
};

const ALL_FLOORS = '__all__';

function ElementMesh({
  element,
  selected,
  onSelect,
}: {
  element: Element3DEntity;
  selected: boolean;
  onSelect: (el: Element3DEntity) => void;
}) {
  const { geometry, type } = element;
  const [w, h, d] = geometry.size;
  const [x, y, z] = geometry.position;
  const color = selected ? '#f5a623' : TYPE_COLORS[type] ?? '#94a3b8';
  if (!element.visible) return null;
  return (
    <mesh
      position={[x, y + h / 2, z]}
      rotation={[0, geometry.rotationY ?? 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(element);
      }}
      castShadow
    >
      <boxGeometry args={[w || 0.2, h || 0.2, d || 0.2]} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={selected ? 0.95 : 0.85}
      />
    </mesh>
  );
}

export function Model3DViewport({ projectId }: ServiceViewportProps) {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const { exportAs, exporting } = useExport(projectId, 'model3d');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [floor, setFloor] = useState<string>(ALL_FLOORS);
  const [mode, setMode] = useState<'3d' | '2d'>('3d');

  const queryKey = ['model3d', projectId];
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => model3dApi.get(projectId),
    retry: false,
  });

  const elements = useMemo(() => data?.elements ?? [], [data]);
  const history = data?.history ?? [];
  const floors = data?.model?.floors ?? [];
  const selected = elements.find((e) => e.id === selectedId) ?? null;

  const visibleElements = useMemo(
    () =>
      floor === ALL_FLOORS
        ? elements
        : elements.filter((e) => e.floor === floor),
    [elements, floor],
  );

  const undoMutation = useMutation({
    mutationFn: () => model3dApi.undo(projectId),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKey, res);
      pushToast('Action annulée.', 'info');
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const redoMutation = useMutation({
    mutationFn: () => model3dApi.redo(projectId),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKey, res);
      pushToast('Action rétablie.', 'info');
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const historyItems: HistoryLogItem[] = history.map((h) => ({
    at: h.createdAt,
    actor: h.appliedBy,
    text: (
      <span className={h.undone ? 'text-slate-400 line-through' : ''}>
        {h.summary}
      </span>
    ),
  }));

  const detail = selected ? (
    <DetailPanel
      title={selected.name || selected.externalId}
      subtitle={`${selected.type} · ${selected.floor}`}
      confidence={selected.confidence}
      sources={selected.sourceRefs}
      fields={[
        { label: 'Type', value: selected.type },
        { label: 'Matériau', value: selected.material },
        {
          label: 'Dimensions',
          value: selected.geometry.size
            .map((v) => v.toFixed(2))
            .join(' × ') + ' m',
        },
        { label: 'Visible', value: selected.visible ? 'Oui' : 'Non' },
      ]}
    />
  ) : (
    <DetailPanel emptyLabel="Cliquez sur un élément 3D pour voir son détail." />
  );

  const floorTabs = [
    { id: ALL_FLOORS, label: 'Tout le bâtiment' },
    ...floors.map((f) => ({ id: f, label: f })),
  ];

  const toolbar = (
    <>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Boxes size={16} className="text-brand-600" /> Modèle 3D
        </span>
        <Tabs
          items={[
            { id: '3d', label: '3D' },
            { id: '2d', label: '2D' },
          ]}
          active={mode}
          onChange={(id) => setMode(id as '3d' | '2d')}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          leftIcon={<Undo2 size={14} />}
          loading={undoMutation.isPending}
          onClick={() => undoMutation.mutate()}
        >
          Annuler
        </Button>
        <Button
          size="sm"
          variant="outline"
          leftIcon={<Redo2 size={14} />}
          loading={redoMutation.isPending}
          onClick={() => redoMutation.mutate()}
        >
          Rétablir
        </Button>
        <ExportMenu service="model3d" onExport={exportAs} loading={exporting} />
      </div>
    </>
  );

  return (
    <ViewportLayout toolbar={toolbar} detail={detail} history={<HistoryLog items={historyItems} />}>
      <div className="flex h-full min-h-0 flex-col">
        {floors.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-1.5">
            <Tabs items={floorTabs} active={floor} onChange={setFloor} />
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-brand-500">
              <Spinner size="lg" />
            </div>
          ) : isError || elements.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState
                icon={<Boxes size={36} />}
                title="Aucun modèle 3D"
                description="Lancez l'analyse pour convertir vos plans 2D en maquette 3D."
              />
            </div>
          ) : (
            <>
              <Canvas
                key={mode}
                shadows
                orthographic={mode === '2d'}
                camera={
                  mode === '2d'
                    ? { position: [0, 40, 0], zoom: 18, up: [0, 0, -1] }
                    : { position: [14, 12, 14], fov: 50 }
                }
                onPointerMissed={() => setSelectedId(null)}
                className="bg-slate-200"
              >
                <ambientLight intensity={0.7} />
                <directionalLight position={[10, 20, 10]} intensity={1} castShadow />
                <Grid
                  args={[60, 60]}
                  cellColor="#cbd5e1"
                  sectionColor="#94a3b8"
                  infiniteGrid
                  fadeDistance={60}
                  position={[0, 0, 0]}
                />
                {visibleElements.map((element) => (
                  <ElementMesh
                    key={element.id}
                    element={element}
                    selected={element.id === selectedId}
                    onSelect={(el) => setSelectedId(el.id)}
                  />
                ))}
                <OrbitControls
                  makeDefault
                  enableRotate={mode === '3d'}
                  enablePan
                />
              </Canvas>
              <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-white/85 px-3 py-1.5 text-[11px] text-slate-500 shadow">
                {visibleElements.length} élément(s) · vue {mode.toUpperCase()}
                {mode === '2d' ? ' (dessus)' : ''}
              </div>
            </>
          )}
        </div>
      </div>
    </ViewportLayout>
  );
}
