import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Organization, User } from '../lib/types';

interface AuthState {
  token: string | null;
  user: User | null;
  organization: Organization | null;
  setAuth: (payload: {
    accessToken: string;
    user: User;
    organization: Organization;
  }) => void;
  setProfile: (payload: { user: User; organization: Organization }) => void;
  clear: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      organization: null,
      setAuth: ({ accessToken, user, organization }) =>
        set({ token: accessToken, user, organization }),
      setProfile: ({ user, organization }) => set({ user, organization }),
      clear: () => set({ token: null, user: null, organization: null }),
      isAuthenticated: () => Boolean(get().token),
    }),
    {
      name: 'batione-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        organization: state.organization,
      }),
    },
  ),
);

export const getToken = (): string | null => useAuthStore.getState().token;
