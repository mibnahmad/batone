import type { ComponentType } from 'react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SERVICE_IDS,
  SERVICE_LABELS,
} from '@batione/shared';
import type { ServiceId } from '@batione/shared';
import { ArrowLeft, Ban } from 'lucide-react';
import {
  clarificationsApi,
  entitlementsApi,
  jobsApi,
  projectsApi,
} from '../lib/api';
import { errorMessage } from '../lib/utils';
import { SERVICE_ICONS } from '../lib/constants';
import { useJobStream } from '../hooks/useJobStream';
import { useUIStore } from '../store/ui';
import { Logo } from '../components/layout/Logo';
import { Spinner } from '../components/ui/Spinner';
import { QuotaBar } from '../components/ui/QuotaBar';
import { EmptyState } from '../components/ui/EmptyState';
import { PipelineStepper } from '../components/workspace/PipelineStepper';
import { DisclaimerBanner } from '../components/workspace/DisclaimerBanner';
import { DocumentManager } from '../components/workspace/DocumentManager';
import { ClarificationsPanel } from '../components/workspace/ClarificationsPanel';
import { ChatPanel } from '../components/workspace/ChatPanel';
import type { ServiceViewportProps } from './services/types';

const TakeoffViewport = lazy(() =>
  import('./services/TakeoffViewport').then((m) => ({ default: m.TakeoffViewport })),
);
const Model3DViewport = lazy(() =>
  import('./services/Model3DViewport').then((m) => ({ default: m.Model3DViewport })),
);
const RebarViewport = lazy(() =>
  import('./services/RebarViewport').then((m) => ({ default: m.RebarViewport })),
);
const PriceStudyViewport = lazy(() =>
  import('./services/PriceStudyViewport').then((m) => ({
    default: m.PriceStudyViewport,
  })),
);

function isServiceId(value: string | undefined): value is ServiceId {
  return SERVICE_IDS.includes(value as ServiceId);
}

const VIEWPORTS: Record<ServiceId, ComponentType<ServiceViewportProps>> = {
  takeoff: TakeoffViewport,
  model3d: Model3DViewport,
  rebar: RebarViewport,
  price_study: PriceStudyViewport,
};

export function ServiceWorkspacePage() {
  const { projectId, service } = useParams<{
    projectId: string;
    service: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId as string),
    enabled: Boolean(projectId),
    retry: false,
  });

  const entitlementsQuery = useQuery({
    queryKey: ['entitlements'],
    queryFn: () => entitlementsApi.list(),
    retry: false,
  });

  const validService = isServiceId(service);

  const jobsQuery = useQuery({
    queryKey: ['jobs', projectId, service],
    queryFn: () => jobsApi.listForProject(projectId as string, service as ServiceId),
    enabled: Boolean(projectId) && validService,
    retry: false,
  });

  // Seed the active job from the latest known job so the stepper reflects state.
  useEffect(() => {
    const latest = jobsQuery.data?.[0];
    if (latest && !activeJobId) setActiveJobId(latest.id);
  }, [jobsQuery.data, activeJobId]);

  const progress = useJobStream(activeJobId);

  const runMutation = useMutation({
    mutationFn: (documentIds: string[]) =>
      jobsApi.run(projectId as string, {
        service: service as ServiceId,
        documentIds,
        options: {},
      }),
    onSuccess: (job) => {
      setActiveJobId(job.id);
      pushToast('Analyse lancée.', 'success');
      queryClient.invalidateQueries({ queryKey: ['jobs', projectId, service] });
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  // Refetch clarifications + service data when a job completes.
  useEffect(() => {
    if (!progress) return;
    if (progress.status === 'succeeded' || progress.status === 'blocked') {
      queryClient.invalidateQueries({ queryKey: ['clarifications', projectId, service] });
      if (validService)
        queryClient.invalidateQueries({ queryKey: [service, projectId] });
    }
  }, [progress?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const clarificationsQuery = useQuery({
    queryKey: ['clarifications', projectId, service],
    queryFn: () =>
      clarificationsApi.list(projectId as string, service as ServiceId),
    enabled: Boolean(projectId) && validService,
    retry: false,
  });

  const entitlement = useMemo(
    () =>
      entitlementsQuery.data?.find((e) => e.service === service) ?? null,
    [entitlementsQuery.data, service],
  );

  if (!projectId || !validService) {
    return <Navigate to="/app" replace />;
  }

  if (projectQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-brand-500">
        <Spinner size="lg" />
      </div>
    );
  }

  const project = projectQuery.data;
  if (!project) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-slate-50">
        <EmptyState
          title="Projet introuvable"
          description="Ce projet n'existe pas ou a été supprimé."
          action={
            <Link
              to="/app"
              className="text-sm font-semibold text-brand-600 hover:underline"
            >
              Retour au tableau de bord
            </Link>
          }
        />
      </div>
    );
  }

  const enabledServices = (project.services ?? []).filter(isServiceId);
  const Viewport = VIEWPORTS[service];
  const openClarifications = (clarificationsQuery.data ?? []).filter(
    (c) => c.status === 'open',
  ).length;

  const liveProgress = progress
    ? { ...progress, openClarifications: openClarifications || progress.openClarifications }
    : null;

  const exhausted = entitlement?.status === 'exhausted';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/app')}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Retour"
          >
            <ArrowLeft size={18} />
          </button>
          <Logo variant="light" size="sm" />
          <div className="hidden border-l border-slate-200 pl-3 sm:block">
            <p className="text-sm font-semibold text-slate-800">{project.name}</p>
            {project.reference && (
              <p className="text-[11px] text-slate-400">Réf. {project.reference}</p>
            )}
          </div>
        </div>

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {enabledServices.map((s) => {
            const Icon = SERVICE_ICONS[s];
            const active = s === service;
            return (
              <Link
                key={s}
                to={`/app/projects/${projectId}/${s}`}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon size={15} />
                {SERVICE_LABELS[s]}
              </Link>
            );
          })}
        </nav>

        <QuotaBar entitlement={entitlement} />
      </header>

      {/* Pipeline stepper */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2">
        <PipelineStepper service={service} progress={liveProgress} />
      </div>

      <DisclaimerBanner service={service} />

      {exhausted && (
        <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          <Ban size={14} />
          Quota épuisé pour ce service. Les nouvelles analyses sont bloquées
          jusqu'au renouvellement.
        </div>
      )}

      {/* Main region */}
      <div className="flex min-h-0 flex-1">
        {/* Left panel */}
        <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DocumentManager
              projectId={projectId}
              service={service}
              onRun={(ids) => runMutation.mutate(ids)}
              running={runMutation.isPending}
            />
          </div>
          <div className="max-h-[45%] overflow-y-auto border-t border-slate-200 p-3">
            <ClarificationsPanel projectId={projectId} service={service} />
          </div>
        </aside>

        {/* Center viewport */}
        <main className="min-w-0 flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-brand-500">
                <Spinner size="lg" />
              </div>
            }
          >
            <Viewport projectId={projectId} project={project} />
          </Suspense>
        </main>

        {/* Right chat */}
        <aside className="hidden w-80 shrink-0 border-l border-slate-200 xl:block">
          <ChatPanel
            projectId={projectId}
            service={service}
            onApplied={() => {
              queryClient.invalidateQueries({ queryKey: [service, projectId] });
              queryClient.invalidateQueries({
                queryKey: ['clarifications', projectId, service],
              });
            }}
          />
        </aside>
      </div>
    </div>
  );
}
