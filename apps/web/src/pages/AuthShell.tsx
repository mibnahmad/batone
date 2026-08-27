import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/layout/Logo';

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-ink-950">
      <div className="hidden flex-1 flex-col justify-between p-12 lg:flex">
        <Logo variant="dark" size="md" />
        <div>
          <h1 className="max-w-md text-4xl font-black leading-tight text-white">
            La traçabilité, <span className="text-brand-500">au cœur</span> de
            chaque chiffre.
          </h1>
          <p className="mt-4 max-w-sm text-slate-400">
            Métré, 3D, ferraillage et étude de prix. Chaque valeur générée par
            l'IA reste liée à sa source et à son niveau de confiance.
          </p>
        </div>
        <p className="text-xs text-slate-500">
          © {new Date().getFullYear()} BatiOne Construction
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 lg:hidden">
            <Logo variant="light" size="md" />
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-xl sm:p-8">
            <Link
              to="/"
              className="text-xs font-medium text-slate-400 hover:text-slate-600"
            >
              ← Retour à l'accueil
            </Link>
            <h2 className="mt-3 text-2xl font-bold text-slate-900">{title}</h2>
            <p className="mb-6 mt-1 text-sm text-slate-500">{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
