import { useMutation } from '@tanstack/react-query';
import type { ExportFormat, ServiceId } from '@batione/shared';
import { exportsApi } from '../lib/api';
import { errorMessage } from '../lib/utils';
import { useUIStore } from '../store/ui';

export function useExport(projectId: string, service: ServiceId) {
  const pushToast = useUIStore((s) => s.pushToast);

  const mutation = useMutation({
    mutationFn: (format: ExportFormat) =>
      exportsApi.create(projectId, service, format),
    onSuccess: (artifact) => {
      pushToast(`Export prêt : ${artifact.filename}`, 'success');
      const href = artifact.url || exportsApi.downloadUrl(artifact.id);
      const link = document.createElement('a');
      link.href = href;
      link.download = artifact.filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    onError: (err) => pushToast(errorMessage(err), 'error'),
  });

  return {
    exportAs: (format: ExportFormat) => mutation.mutate(format),
    exporting: mutation.isPending,
  };
}
