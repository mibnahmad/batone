import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ServiceId } from '@batione/shared';
import { Bot, Check, Send, Sparkles, Undo2, User } from 'lucide-react';
import { chatApi } from '../../lib/api';
import type { ChatMessage, ChatProposal } from '../../lib/types';
import { errorMessage } from '../../lib/utils';
import { useUIStore } from '../../store/ui';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

export interface ChatPanelProps {
  projectId: string;
  service: ServiceId;
  /** Called after a proposal is applied so the viewport can refetch. */
  onApplied?: () => void;
}

const QUICK_ACTIONS = [
  'Explique cette valeur',
  'Recalcule le total',
  'Quelles hypothèses ont été prises ?',
  'Liste les incohérences',
];

export function ChatPanel({ projectId, service, onApplied }: ChatPanelProps) {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const queryKey = ['chat', projectId, service];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => chatApi.get(projectId, service),
    retry: false,
  });

  const messages: ChatMessage[] = data?.messages ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (content: string) => chatApi.send(projectId, service, content),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKey, {
        session: data?.session,
        messages: res.messages,
      });
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const applyMutation = useMutation({
    mutationFn: (messageId: string) =>
      chatApi.apply(projectId, service, messageId),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKey, {
        session: data?.session,
        messages: res.messages,
      });
      pushToast('Proposition appliquée.', 'success');
      onApplied?.();
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const discardMutation = useMutation({
    mutationFn: (messageId: string) =>
      chatApi.discard(projectId, service, messageId),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKey, {
        session: data?.session,
        messages: res.messages,
      });
      pushToast('Proposition annulée.', 'info');
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  const submit = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || sendMutation.isPending) return;
    setInput('');
    sendMutation.mutate(trimmed);
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-ai-100 bg-ai-50 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ai-600 text-white">
          <Sparkles size={16} />
        </div>
        <div>
          <p className="text-sm font-semibold text-ai-900">Assistant BatiOne</p>
          <p className="text-[11px] text-ai-600">
            Modifiez le projet en langage naturel
          </p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="flex justify-center py-6 text-ai-500">
            <Spinner />
          </div>
        ) : isError ? (
          <p className="px-2 py-6 text-center text-xs text-slate-400">
            L'assistant est momentanément indisponible.
          </p>
        ) : messages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ai-200 bg-ai-50/50 p-3 text-center text-xs text-ai-700">
            Posez une question ou demandez une modification. L'assistant
            proposera un changement que vous pourrez vérifier avant application.
          </div>
        ) : (
          messages.map((msg) => (
            <ChatBubble
              key={msg.id}
              message={msg}
              applying={applyMutation.isPending}
              discarding={discardMutation.isPending}
              onApply={() => applyMutation.mutate(msg.id)}
              onDiscard={() => discardMutation.mutate(msg.id)}
            />
          ))
        )}
        {sendMutation.isPending && (
          <div className="flex items-center gap-2 text-xs text-ai-500">
            <Spinner size="sm" /> L'assistant réfléchit…
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 px-3 py-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action}
              onClick={() => submit(action)}
              disabled={sendMutation.isPending}
              className="rounded-full border border-ai-200 bg-ai-50 px-2.5 py-1 text-[11px] font-medium text-ai-700 hover:bg-ai-100 disabled:opacity-50"
            >
              {action}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            rows={2}
            placeholder="Écrivez à l'assistant…"
            className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-ai-500 focus:outline-none focus:ring-2 focus:ring-ai-500/30"
          />
          <Button
            type="submit"
            variant="ai"
            size="md"
            loading={sendMutation.isPending}
            className="h-[52px]"
          >
            <Send size={16} />
          </Button>
        </form>
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  onApply,
  onDiscard,
  applying,
  discarding,
}: {
  message: ChatMessage;
  onApply: () => void;
  onDiscard: () => void;
  applying: boolean;
  discarding: boolean;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div className={`flex max-w-[90%] gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
        <div
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            isUser ? 'bg-slate-200 text-slate-600' : 'bg-ai-600 text-white'
          }`}
        >
          {isUser ? <User size={13} /> : <Bot size={13} />}
        </div>
        <div>
          <div
            className={`rounded-2xl px-3 py-2 text-sm ${
              isUser
                ? 'bg-slate-900 text-white'
                : 'bg-ai-50 text-slate-800'
            }`}
          >
            {message.content}
          </div>
          {message.proposal && (
            <ProposalCard
              proposal={message.proposal}
              onApply={onApply}
              onDiscard={onDiscard}
              applying={applying}
              discarding={discarding}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  onApply,
  onDiscard,
  applying,
  discarding,
}: {
  proposal: ChatProposal;
  onApply: () => void;
  onDiscard: () => void;
  applying: boolean;
  discarding: boolean;
}) {
  return (
    <div className="mt-2 rounded-xl border border-ai-300 bg-white p-3 shadow-sm">
      <p className="flex items-center gap-1 text-xs font-semibold text-ai-800">
        <Sparkles size={12} /> Proposition de modification
      </p>
      <p className="mt-1 text-xs text-slate-600">{proposal.summary}</p>
      {proposal.affectedCount > 0 && (
        <p className="mt-1 text-[11px] text-slate-400">
          {proposal.affectedCount} élément(s) concerné(s)
        </p>
      )}
      {proposal.diff.length > 0 && (
        <ul className="mt-2 space-y-1">
          {proposal.diff.slice(0, 6).map((d, i) => (
            <li
              key={i}
              className="rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
            >
              <span className="font-medium">{d.property}</span> :{' '}
              <span className="text-red-500 line-through">{String(d.before)}</span>{' '}
              → <span className="text-emerald-600">{String(d.after)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="ai"
          loading={applying}
          leftIcon={<Check size={14} />}
          onClick={onApply}
        >
          Appliquer
        </Button>
        <Button
          size="sm"
          variant="outline"
          loading={discarding}
          leftIcon={<Undo2 size={14} />}
          onClick={onDiscard}
        >
          Annuler
        </Button>
      </div>
    </div>
  );
}
