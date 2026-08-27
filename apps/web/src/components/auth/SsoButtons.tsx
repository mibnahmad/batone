import { useState } from 'react';
import { useAuthActions } from '../../hooks/useAuth';

/** Local mock SSO — the backend implements /auth/oauth/:provider. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 23 23" className="h-4 w-4">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

export function SsoButtons({ organizationName }: { organizationName?: string }) {
  const { oauth } = useAuthActions();
  const [pending, setPending] = useState<'google' | 'microsoft' | null>(null);

  const start = (provider: 'google' | 'microsoft') => {
    setPending(provider);
    const label = provider === 'google' ? 'Google' : 'Microsoft';
    oauth.mutate(
      {
        provider,
        email: `demo.${provider}@batione.fr`,
        fullName: `Utilisateur ${label}`,
        organizationName: organizationName?.trim() || `Organisation ${label}`,
      },
      { onSettled: () => setPending(null) },
    );
  };

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <button
        type="button"
        onClick={() => start('google')}
        disabled={pending !== null}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        <GoogleIcon />
        {pending === 'google' ? 'Connexion…' : 'Google'}
      </button>
      <button
        type="button"
        onClick={() => start('microsoft')}
        disabled={pending !== null}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        <MicrosoftIcon />
        {pending === 'microsoft' ? 'Connexion…' : 'Microsoft'}
      </button>
    </div>
  );
}
