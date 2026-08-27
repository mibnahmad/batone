import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SERVICE_IDS,
  SERVICE_LABELS,
  SERVICE_QUOTA_UNIT,
} from '@batione/shared';
import type { CreateProjectDto, EntitlementView, ServiceId } from '@batione/shared';
import { Building2, MapPin, Plus, Trash2, FolderKanban } from 'lucide-react';
import { entitlementsApi, projectsApi } from '../lib/api';
import type { Project } from '../lib/types';
import { errorMessage, formatDate } from '../lib/utils';
import { SERVICE_ICONS } from '../lib/constants';
import { useUIStore } from '../store/ui';
import { AppHeader } from '../components/layout/AppHeader';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Spinner';
import { QuotaBar } from '../components/ui/QuotaBar';

export function DashboardPage() {
  const [modalOpen, setModalOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
    retry: false,
  });

  const entitlementsQuery = useQuery({
    queryKey: ['entitlements'],
    queryFn: () => entitlementsApi.list(),
    retry: false,
  });

  const projects = projectsQuery.data ?? [];
  const entitlements = entitlementsQuery.data ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <EntitlementsGrid
          entitlements={entitlements}
          loading={entitlementsQuery.isLoading}
        />

        <div className="mb-4 mt-10 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Projets</h1>
            <p className="text-sm text-slate-500">
              Gérez vos affaires et lancez les analyses.
            </p>
          </div>
          <Button
            variant="primary"
            leftIcon={<Plus size={16} />}
            onClick={() => setModalOpen(true)}
          >
            Nouveau projet
          </Button>
        </div>

        {projectsQuery.isLoading ? (
          <div className="flex justify-center py-16 text-brand-500">
            <Spinner size="lg" />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={<FolderKanban size={36} />}
            title="Aucun projet pour le moment"
            description="Créez votre premier projet pour importer des plans et lancer une analyse."
            action={
              <Button
                variant="primary"
                leftIcon={<Plus size={16} />}
                onClick={() => setModalOpen(true)}
              >
                Créer un projet
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </main>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}

function EntitlementsGrid({
  entitlements,
  loading,
}: {
  entitlements: EntitlementView[];
  loading: boolean;
}) {
  const byService = new Map(entitlements.map((e) => [e.service, e]));
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Droits & quotas par service
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SERVICE_IDS.map((service) => {
          const ent = byService.get(service) ?? null;
          const Icon = SERVICE_ICONS[service];
          const inactive = !ent || ent.status === 'inactive';
          return (
            <Card key={service} className={inactive ? 'opacity-70' : ''}>
              <CardBody className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                    <Icon size={16} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {SERVICE_LABELS[service]}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {SERVICE_QUOTA_UNIT[service]}
                    </p>
                  </div>
                </div>
                {loading ? (
                  <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
                ) : inactive ? (
                  <Badge tone="neutral">Non activé</Badge>
                ) : (
                  <QuotaBar entitlement={ent} />
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);

  const remove = useMutation({
    mutationFn: () => projectsApi.remove(project.id),
    onSuccess: () => {
      pushToast('Projet supprimé.', 'success');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const services = project.services ?? [];
  const firstService = services[0] ?? 'takeoff';

  return (
    <Card className="flex flex-col">
      <CardBody className="flex flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">{project.name}</h3>
            {project.reference && (
              <p className="text-xs text-slate-400">Réf. {project.reference}</p>
            )}
          </div>
          <button
            onClick={() => {
              if (confirm(`Supprimer le projet « ${project.name} » ?`))
                remove.mutate();
            }}
            className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
            aria-label="Supprimer"
          >
            <Trash2 size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-1 text-xs text-slate-500">
          {project.client && (
            <span className="inline-flex items-center gap-1">
              <Building2 size={12} /> {project.client}
            </span>
          )}
          {project.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={12} /> {project.location}
            </span>
          )}
          <span className="text-slate-400">
            Créé le {formatDate(project.createdAt)}
          </span>
        </div>

        <div className="flex flex-wrap gap-1">
          {services.map((service) => (
            <Badge key={service} tone="brand">
              {SERVICE_LABELS[service as ServiceId] ?? service}
            </Badge>
          ))}
          {services.length === 0 && (
            <Badge tone="neutral">Aucun service</Badge>
          )}
        </div>

        <div className="mt-auto pt-2">
          <Link to={`/app/projects/${project.id}/${firstService}`}>
            <Button variant="secondary" size="sm" className="w-full">
              Ouvrir l'espace de travail
            </Button>
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}

function NewProjectModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const [form, setForm] = useState({
    name: '',
    reference: '',
    client: '',
    location: '',
    description: '',
  });
  const [services, setServices] = useState<ServiceId[]>(['takeoff']);

  const update = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleService = (service: ServiceId) =>
    setServices((prev) =>
      prev.includes(service)
        ? prev.filter((s) => s !== service)
        : [...prev, service],
    );

  const reset = () => {
    setForm({ name: '', reference: '', client: '', location: '', description: '' });
    setServices(['takeoff']);
  };

  const create = useMutation({
    mutationFn: (payload: CreateProjectDto) => projectsApi.create(payload),
    onSuccess: () => {
      pushToast('Projet créé.', 'success');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      reset();
      onClose();
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const canSubmit = form.name.trim().length >= 2 && services.length > 0;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    create.mutate({
      name: form.name.trim(),
      reference: form.reference.trim() || undefined,
      client: form.client.trim() || undefined,
      location: form.location.trim() || undefined,
      description: form.description.trim() || undefined,
      services,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouveau projet"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            Créer le projet
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Nom du projet *"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Résidence Les Tilleuls"
            required
          />
          <Input
            label="Référence"
            value={form.reference}
            onChange={(e) => update('reference', e.target.value)}
            placeholder="2024-042"
          />
          <Input
            label="Client / Maître d'ouvrage"
            value={form.client}
            onChange={(e) => update('client', e.target.value)}
            placeholder="SCI Horizon"
          />
          <Input
            label="Localisation"
            value={form.location}
            onChange={(e) => update('location', e.target.value)}
            placeholder="Lyon (69)"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700">
            Description
          </label>
          <textarea
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            rows={3}
            placeholder="Construction de 12 logements collectifs…"
            className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">
            Services à activer *
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SERVICE_IDS.map((service) => {
              const Icon = SERVICE_ICONS[service];
              const active = services.includes(service);
              return (
                <button
                  key={service}
                  type="button"
                  onClick={() => toggleService(service)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'border-brand-500 bg-brand-50 text-brand-800'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={16} />
                  <span className="font-medium">{SERVICE_LABELS[service]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </form>
    </Modal>
  );
}
