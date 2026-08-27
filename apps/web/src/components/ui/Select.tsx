import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, id, ...rest }, ref) => {
    const selectId = id ?? rest.name;
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={selectId}
            className="text-sm font-medium text-slate-700"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900',
            'focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500',
            error ? 'border-red-400' : 'border-slate-300',
            className,
          )}
          {...rest}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  },
);

Select.displayName = 'Select';
