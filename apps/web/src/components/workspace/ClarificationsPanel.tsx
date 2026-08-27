import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ServiceId } from '@batione/shared';
import { AlertTriangle, HelpCircle, Check } from 'lucide-react';
import { clarificationsApi, rebarApi } from '../../lib/api';
import type { Clarification } from '../../lib/types';
import { errorMessage } from '../../lib/utils';
import { useUIStore } from '../../store/ui';
import { Button } from '../ui/Button';
import { SourceRefPopover } from '../ui/SourceRefPopover';

export interface ClarificationsPanelProps {
  projectId: string;
  service: ServiceId;
}

export function ClarificationsPanel({
  projectId,
  service,
}: ClarificationsPanelProps) {
  const { data } = useQuery({
    queryKey: ['clarifications', projectId, service],
    queryFn: () => clarificationsApi.list(projectId, service),
    retry: false,
  });

  const open = (data ?? []).filter((c) => c.status === 'open');
  if (open.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50">
      <div className="flex items-center gap-2 border-b border-amber-200 px-3 py-2">
        <AlertTriangle size={15} className="text-amber-600" />
        <p className="text-sm font-semibold text-amber-800">
          Clarifications requises ({open.length})
        </p>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <p className="text-[11px] text-amber-700">
          Ces questions bloquent la finalisation. Répondez ou ignorez-les.
        </p>
        {open.map((clarification) => (
          <ClarificationCard
            key={clarification.id}
            clarification={clarification}
            projectId={projectId}
            service={service}
          />
        ))}
      </div>
    </div>
  );
}

function ClarificationCard({
  clarification,
  projectId,
  service,
}: {
  clarification: Clarification;
  projectId: string;
  service: ServiceId;
}) {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const [answer, setAnswer] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ['clarifications', projectId, service],
    });
    queryClient.invalidateQueries({ queryKey: [service, projectId] });
  };

  const answerMutation = useMutation({
    mutationFn: async (value: string) => {
      await clarificationsApi.answer(clarification.id, value);
      // An answered question must immediately feed the deterministic engine,
      // otherwise the table keeps showing the blocked state.
      if (service === 'rebar') await rebarApi.recompute(projectId);
    },
    onSuccess: () => {
      pushToast('Réponse enregistrée, calcul mis à jour.', 'success');
      invalidate();
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const dismissMutation = useMutation({
    mutationFn: () => clarificationsApi.dismiss(clarification.id),
    onSuccess: () => {
      pushToast('Question ignorée.', 'info');
      invalidate();
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  return (
    <div className="rounded-lg border border-amber-200 bg-white p-3">
      <div className="flex items-start gap-2">
        <HelpCircle size={14} className="mt-0.5 shrink-0 text-amber-500" />
        <p className="text-sm text-slate-800">{clarification.question}</p>
      </div>

      {clarification.sourceRefs.length > 0 && (
        <div className="mt-1 pl-6">
          <SourceRefPopover sources={clarification.sourceRefs} />
        </div>
      )}

      {clarification.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 pl-6">
          {clarification.options.map((option) => (
            <button
              key={option}
              onClick={() => answerMutation.mutate(option)}
              disabled={answerMutation.isPending}
              className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2 pl-6">
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && answer.trim())
              answerMutation.mutate(answer.trim());
          }}
          placeholder="Votre réponse…"
          className="h-8 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        />
        <Button
          size="sm"
          variant="primary"
          leftIcon={<Check size={13} />}
          loading={answerMutation.isPending}
          disabled={!answer.trim()}
          onClick={() => answerMutation.mutate(answer.trim())}
        >
          Répondre
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={dismissMutation.isPending}
          onClick={() => dismissMutation.mutate()}
        >
          Ignorer
        </Button>
      </div>
    </div>
  );
}
