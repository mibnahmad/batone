import {
  PIPELINE_LABELS,
  PIPELINE_ORDER,
  PipelineStep,
} from '@batione/shared';
import type { JobProgress, ServiceId } from '@batione/shared';
import { AlertTriangle, Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Spinner } from '../ui/Spinner';

type StepState = 'pending' | 'active' | 'done' | 'blocked' | 'failed';

export interface PipelineStepperProps {
  service: ServiceId;
  progress: JobProgress | null;
}

function stepStateFor(
  step: PipelineStep,
  progress: JobProgress | null,
): StepState {
  if (!progress) return 'pending';
  const currentIndex = PIPELINE_ORDER.indexOf(progress.step);
  const thisIndex = PIPELINE_ORDER.indexOf(step);

  if (progress.status === 'succeeded') return 'done';
  if (thisIndex < currentIndex) return 'done';
  if (thisIndex > currentIndex) return 'pending';

  // current step
  if (progress.status === 'failed') return 'failed';
  if (progress.status === 'blocked' || (progress.openClarifications ?? 0) > 0)
    return 'blocked';
  return 'active';
}

const CIRCLE: Record<StepState, string> = {
  pending: 'border-slate-300 text-slate-400 bg-white',
  active: 'border-brand-500 text-brand-600 bg-brand-50',
  done: 'border-emerald-500 text-white bg-emerald-500',
  blocked: 'border-amber-500 text-amber-700 bg-amber-100',
  failed: 'border-red-500 text-white bg-red-500',
};

export function PipelineStepper({ service, progress }: PipelineStepperProps) {
  const labels = PIPELINE_LABELS[service];

  return (
    <div className="flex w-full items-center overflow-x-auto py-1">
      {PIPELINE_ORDER.map((step, idx) => {
        const state = stepStateFor(step, progress);
        const isLast = idx === PIPELINE_ORDER.length - 1;
        return (
          <div key={step} className="flex flex-1 items-center">
            <div className="flex min-w-max flex-col items-center gap-1">
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold',
                  CIRCLE[state],
                )}
              >
                {state === 'done' ? (
                  <Check size={14} />
                ) : state === 'active' ? (
                  <Spinner size="sm" className="text-brand-600" />
                ) : state === 'blocked' ? (
                  <AlertTriangle size={13} />
                ) : state === 'failed' ? (
                  <X size={14} />
                ) : (
                  idx + 1
                )}
              </div>
              <span
                className={cn(
                  'whitespace-nowrap px-1 text-[11px] font-medium',
                  state === 'pending' ? 'text-slate-400' : 'text-slate-600',
                )}
              >
                {labels[step]}
              </span>
              {state === 'active' && (
                <span className="text-[10px] text-brand-600">
                  {progress?.progress ?? 0}%
                </span>
              )}
            </div>
            {!isLast && (
              <div
                className={cn(
                  'mx-1 h-0.5 flex-1',
                  state === 'done' ? 'bg-emerald-400' : 'bg-slate-200',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
