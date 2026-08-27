import { cn } from '../../lib/utils';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

const SIZES = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-[3px]',
};

export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label ?? 'Chargement'}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-t-transparent',
        SIZES[size],
        className,
      )}
    />
  );
}
