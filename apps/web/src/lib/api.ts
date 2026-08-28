import type {
  CreateProjectDto,
  EntitlementView,
  ExportFormat,
  ServiceId,
} from '@batione/shared';
import { getToken, useAuthStore } from '../store/auth';
import type {
  AuthResponse,
  AuditEvent,
  ChatPostResponse,
  ChatResponse,
  Clarification,
  Job,
  MeResponse,
  Model3DResponse,
  PriceItem,
  PriceStudyResponse,
  Project,
  ProjectDocument,
  RebarResponse,
  TakeoffResponse,
  ExportArtifact,
} from './types';

export const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Thrown when the backend answers 402 — quota exhausted for a service. */
export class QuotaExhaustedError extends ApiError {
  constructor(message = 'Quota épuisé pour ce service.') {
    super(402, message, 'quota_exhausted');
    this.name = 'QuotaExhaustedError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Skip JSON stringify (used for multipart). */
  raw?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, raw = false } = options;
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (raw) {
      payload = body as BodyInit;
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: payload,
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Serveur indisponible. Réessayez plus tard.', 'network');
  }

  if (res.status === 401) {
    useAuthStore.getState().clear();
    throw new ApiError(401, 'Session expirée. Veuillez vous reconnecter.', 'unauthorized');
  }

  if (res.status === 402) {
    const message = await safeMessage(res);
    throw new QuotaExhaustedError(message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  if (!res.ok) {
    const message = await safeMessage(res);
    throw new ApiError(res.status, message, 'error');
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return undefined as T;
}

async function safeMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data === 'string') return data;
    if (data && typeof data.message === 'string') return data.message;
    if (data && Array.isArray(data.message)) return data.message.join(', ');
  } catch {
    /* ignore */
  }
  return `Erreur ${res.status}`;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export interface RegisterPayload {
  organizationName: string;
  fullName: string;
  email: string;
  password: string;
  role: string;
}

export const authApi = {
  register: (payload: RegisterPayload) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: payload }),
  login: (payload: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: payload }),
  me: () => request<MeResponse>('/auth/me'),
  oauth: (
    provider: 'google' | 'microsoft',
    payload: { email: string; fullName: string; organizationName: string },
  ) =>
    request<AuthResponse>(`/auth/oauth/${provider}`, {
      method: 'POST',
      body: payload,
    }),
};

/* ------------------------------------------------------------------ */
/* Entitlements & projects                                             */
/* ------------------------------------------------------------------ */

export const entitlementsApi = {
  list: () => request<EntitlementView[]>('/entitlements'),
};

export const projectsApi = {
  list: () => request<Project[]>('/projects'),
  get: (id: string) => request<Project>(`/projects/${id}`),
  create: (payload: CreateProjectDto) =>
    request<Project>('/projects', { method: 'POST', body: payload }),
  remove: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),
};

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export const documentsApi = {
  list: (projectId: string) =>
    request<ProjectDocument[]>(`/projects/${projectId}/documents`),
  upload: (
    projectId: string,
    file: File,
    meta: { kind: string; floor?: string; label?: string },
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', meta.kind);
    if (meta.floor) form.append('floor', meta.floor);
    if (meta.label) form.append('label', meta.label);
    return request<ProjectDocument>(`/projects/${projectId}/documents`, {
      method: 'POST',
      body: form,
      raw: true,
    });
  },
  patch: (docId: string, payload: Partial<ProjectDocument>) =>
    request<ProjectDocument>(`/documents/${docId}`, {
      method: 'PATCH',
      body: payload,
    }),
  remove: (docId: string) =>
    request<void>(`/documents/${docId}`, { method: 'DELETE' }),
};

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export const jobsApi = {
  run: (
    projectId: string,
    payload: { service: ServiceId; documentIds: string[]; options?: Record<string, unknown> },
  ) =>
    request<Job>(`/projects/${projectId}/run`, {
      method: 'POST',
      body: { ...payload, options: payload.options ?? {} },
    }),
  listForProject: (projectId: string, service: ServiceId) =>
    request<Job[]>(`/projects/${projectId}/jobs?service=${service}`),
  get: (jobId: string) => request<Job>(`/jobs/${jobId}`),
};

/* ------------------------------------------------------------------ */
/* Clarifications                                                      */
/* ------------------------------------------------------------------ */

export const clarificationsApi = {
  list: (projectId: string, service: ServiceId) =>
    request<Clarification[]>(
      `/projects/${projectId}/clarifications?service=${service}`,
    ),
  answer: (cid: string, answer: string) =>
    request<Clarification>(`/clarifications/${cid}/answer`, {
      method: 'POST',
      body: { answer },
    }),
  dismiss: (cid: string) =>
    request<Clarification>(`/clarifications/${cid}/dismiss`, { method: 'POST' }),
};

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

export const chatApi = {
  get: (projectId: string, service: ServiceId) =>
    request<ChatResponse>(`/projects/${projectId}/chat/${service}`),
  send: (projectId: string, service: ServiceId, content: string) =>
    request<ChatPostResponse>(`/projects/${projectId}/chat/${service}`, {
      method: 'POST',
      body: { content },
    }),
  apply: (projectId: string, service: ServiceId, messageId: string) =>
    request<ChatPostResponse>(`/projects/${projectId}/chat/${service}/apply`, {
      method: 'POST',
      body: { messageId },
    }),
  discard: (projectId: string, service: ServiceId, messageId: string) =>
    request<ChatPostResponse>(`/projects/${projectId}/chat/${service}/discard`, {
      method: 'POST',
      body: { messageId },
    }),
};

/* ------------------------------------------------------------------ */
/* Service data                                                        */
/* ------------------------------------------------------------------ */

export const takeoffApi = {
  get: (projectId: string) =>
    request<TakeoffResponse>(`/projects/${projectId}/takeoff`),
  correct: (
    lineId: string,
    payload: { field: string; value: unknown; reason?: string },
  ) =>
    request<TakeoffResponse>(`/takeoff/${lineId}`, {
      method: 'PATCH',
      body: payload,
    }),
};

export const model3dApi = {
  get: (projectId: string) =>
    request<Model3DResponse>(`/projects/${projectId}/model3d`),
  patchElement: (
    elementId: string,
    payload: { field: string; value: unknown; reason?: string },
  ) =>
    request<Model3DResponse>(`/model3d/elements/${elementId}`, {
      method: 'PATCH',
      body: payload,
    }),
  undo: (projectId: string) =>
    request<Model3DResponse>(`/projects/${projectId}/model3d/undo`, {
      method: 'POST',
    }),
  redo: (projectId: string) =>
    request<Model3DResponse>(`/projects/${projectId}/model3d/redo`, {
      method: 'POST',
    }),
};

export const rebarApi = {
  get: (projectId: string) =>
    request<RebarResponse>(`/projects/${projectId}/rebar`),
  patchElement: (
    elementId: string,
    payload: { field: string; value: unknown; reason?: string },
  ) =>
    request<RebarResponse>(`/rebar/elements/${elementId}`, {
      method: 'PATCH',
      body: payload,
    }),
  recompute: (projectId: string) =>
    request<RebarResponse>(`/projects/${projectId}/rebar/recompute`, {
      method: 'POST',
    }),
};

export const priceStudyApi = {
  get: (projectId: string) =>
    request<PriceStudyResponse>(`/projects/${projectId}/price-study`),
  addItem: (projectId: string, payload: Partial<PriceItem>) =>
    request<PriceStudyResponse>(`/projects/${projectId}/price-study/items`, {
      method: 'POST',
      body: payload,
    }),
  patchItem: (
    itemId: string,
    payload: { field: string; value: unknown; reason?: string },
  ) =>
    request<PriceStudyResponse>(`/price-items/${itemId}`, {
      method: 'PATCH',
      body: payload,
    }),
  removeItem: (itemId: string) =>
    request<PriceStudyResponse>(`/price-items/${itemId}`, { method: 'DELETE' }),
  patchStudy: (projectId: string, payload: Record<string, unknown>) =>
    request<PriceStudyResponse>(`/projects/${projectId}/price-study`, {
      method: 'PATCH',
      body: payload,
    }),
  importTakeoff: (projectId: string) =>
    request<PriceStudyResponse>(
      `/projects/${projectId}/price-study/import-takeoff`,
      { method: 'POST' },
    ),
};

/* ------------------------------------------------------------------ */
/* Exports & audit                                                     */
/* ------------------------------------------------------------------ */

export const exportsApi = {
  create: (projectId: string, service: ServiceId, format: ExportFormat) =>
    request<ExportArtifact>(`/projects/${projectId}/export`, {
      method: 'POST',
      body: { service, format },
    }),
  downloadUrl: (exportId: string) => {
    const token = getToken();
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${API_BASE}/exports/${exportId}/download${q}`;
  },
};

export const auditApi = {
  list: (projectId: string) =>
    request<AuditEvent[]>(`/projects/${projectId}/audit`),
};

/** Build the SSE stream URL with the token as a query param. */
export function jobStreamUrl(jobId: string): string {
  const token = getToken();
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${API_BASE}/jobs/${jobId}/stream${q}`;
}
