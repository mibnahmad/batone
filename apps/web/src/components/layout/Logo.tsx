import { cn } from '../../lib/utils';

export interface LogoProps {
  variant?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const TEXT_SIZE = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-2xl',
};

const MARK_SIZE = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

export function Logo({ variant = 'dark', size = 'md', className }: LogoProps) {
  const dark = variant === 'dark';
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className={cn('inline-flex items-center justify-center', MARK_SIZE[size])}>
        <img src="/logo.png" alt="" className="h-full w-full object-contain" />
      </span>
      <span
        className={cn(
          'font-bold tracking-tight',
          TEXT_SIZE[size],
          dark ? 'text-white' : 'text-slate-900',
        )}
      >
        BatiOne
      </span>
    </span>
  );
}
