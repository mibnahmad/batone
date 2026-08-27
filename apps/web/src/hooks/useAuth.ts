import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../lib/api';
import type { RegisterPayload } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { useUIStore } from '../store/ui';
import { errorMessage } from '../lib/utils';
import type { AuthResponse } from '../lib/types';

export function useAuthActions() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const pushToast = useUIStore((s) => s.pushToast);

  const onSuccess = (res: AuthResponse) => {
    setAuth(res);
    pushToast(`Bienvenue, ${res.user.fullName} !`, 'success');
    navigate('/app');
  };
  const onError = (err: unknown) => pushToast(errorMessage(err), 'error');

  const login = useMutation({
    mutationFn: (payload: { email: string; password: string }) =>
      authApi.login(payload),
    onSuccess,
    onError,
  });

  const register = useMutation({
    mutationFn: (payload: RegisterPayload) => authApi.register(payload),
    onSuccess,
    onError,
  });

  const oauth = useMutation({
    mutationFn: (payload: {
      provider: 'google' | 'microsoft';
      email: string;
      fullName: string;
      organizationName: string;
    }) =>
      authApi.oauth(payload.provider, {
        email: payload.email,
        fullName: payload.fullName,
        organizationName: payload.organizationName,
      }),
    onSuccess,
    onError,
  });

  return { login, register, oauth };
}
