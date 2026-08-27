import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Spinner } from './Spinner';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'ai'
  | 'outline'
  /** Outline on a dark surface (marketing hero). */
  | 'outlineDark';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-500 text-ink-950 hover:bg-brand-400 focus-visible:ring-brand-500 disabled:bg-brand-200',
  secondary:
    'bg-slate-800 text-white hover:bg-slate-700 focus-visible:ring-slate-500',
  outline:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-400',
  outlineDark:
    'border border-white/25 bg-transparent text-white hover:bg-white/10 focus-visible:ring-white/40',
  ghost: 'text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-300',
  danger: 'bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500',
  ai: 'bg-ai-600 text-white hover:bg-ai-500 focus-visible:ring-ai-500',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      leftIcon,
      rightIcon,
      className,
      children,
      disabled,
      ...rest
    },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-semibold transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-70',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  ),
);

Button.displayName = 'Button';
