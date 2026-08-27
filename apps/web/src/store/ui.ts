import { create } from 'zustand';

export interface Toast {
  id: string;
  message: string;
  variant: 'info' | 'success' | 'error' | 'warning';
}

interface UIState {
  toasts: Toast[];
  chatOpen: boolean;
  pushToast: (message: string, variant?: Toast['variant']) => void;
  dismissToast: (id: string) => void;
  toggleChat: (open?: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  toasts: [],
  chatOpen: true,
  pushToast: (message, variant = 'info') =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        { id: Math.random().toString(36).slice(2), message, variant },
      ],
    })),
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  toggleChat: (open) =>
    set((state) => ({ chatOpen: open ?? !state.chatOpen })),
}));
