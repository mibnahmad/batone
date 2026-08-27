import { PASSWORD_RULES } from '@batione/shared';
import { Check, Circle } from 'lucide-react';
import { cn } from '../../lib/utils';

export function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(value);
        return (
          <li
            key={rule.id}
            className={cn(
              'flex items-center gap-1.5 text-xs transition-colors',
              ok ? 'text-emerald-600' : 'text-slate-400',
            )}
          >
            {ok ? (
              <Check size={13} className="shrink-0" />
            ) : (
              <Circle size={13} className="shrink-0" />
            )}
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}

export function isPasswordValid(value: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(value));
}
