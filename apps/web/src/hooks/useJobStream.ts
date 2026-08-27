import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { JobProgress } from '@batione/shared';
import { jobStreamUrl, jobsApi } from '../lib/api';
import type { Job } from '../lib/types';

function jobToProgress(job: Job): JobProgress {
  return {
    jobId: job.id,
    projectId: job.projectId,
    service: job.service,
    status: job.status,
    step: job.step,
    progress: job.progress,
    message: job.message ?? undefined,
    error: job.error ?? undefined,
    openClarifications: 0,
    updatedAt: job.updatedAt,
  };
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * Live job progress via SSE, with polling fallback when the stream errors.
 * EventSource cannot set headers, so the token is passed as `?token=`.
 */
export function useJobStream(
  jobId: string | null | undefined,
): JobProgress | null {
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [streamFailed, setStreamFailed] = useState(false);
  const failedRef = useRef(false);

  useEffect(() => {
    setProgress(null);
    setStreamFailed(false);
    failedRef.current = false;
    if (!jobId) return;

    let es: EventSource | null = null;
    try {
      es = new EventSource(jobStreamUrl(jobId));
    } catch {
      setStreamFailed(true);
      failedRef.current = true;
      return;
    }

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as JobProgress;
        setProgress(parsed);
        if (TERMINAL.has(parsed.status)) {
          es?.close();
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    es.onerror = () => {
      if (!failedRef.current) {
        failedRef.current = true;
        setStreamFailed(true);
      }
      es?.close();
    };

    return () => {
      es?.close();
    };
  }, [jobId]);

  // Polling fallback: only active if the stream failed and we have a job.
  const pollEnabled = Boolean(jobId) && streamFailed;
  const { data: polled } = useQuery({
    queryKey: ['job-poll', jobId],
    queryFn: () => jobsApi.get(jobId as string),
    enabled: pollEnabled,
    refetchInterval: (query) => {
      const job = query.state.data as Job | undefined;
      if (job && TERMINAL.has(job.status)) return false;
      return 1000;
    },
    retry: false,
  });

  useEffect(() => {
    if (polled) setProgress(jobToProgress(polled));
  }, [polled]);

  return progress;
}
