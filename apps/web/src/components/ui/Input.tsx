import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, id, ...rest }, ref) => {
    const inputId = id ?? rest.name;
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-slate-700"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400',
            'focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500',
            error ? 'border-red-400' : 'border-slate-300',
            className,
          )}
          {...rest}
        />
        {error ? (
          <span className="text-xs text-red-600">{error}</span>
        ) : hint ? (
          <span className="text-xs text-slate-400">{hint}</span>
        ) : null}
      </div>
    );
  },
);

Input.displayName = 'Input';
