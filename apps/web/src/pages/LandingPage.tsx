import { Link } from 'react-router-dom';
import {
  Boxes,
  Calculator,
  FileDown,
  Grid3x3,
  Ruler,
  ShieldCheck,
  Sparkles,
  Users,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { Logo } from '../components/layout/Logo';
import { Button } from '../components/ui/Button';
import { RegisterForm } from '../components/auth/AuthForms';
import { useAuthStore } from '../store/auth';

const FEATURES = [
  {
    icon: Ruler,
    title: 'Métré',
    text: 'Quantités extraites des plans, tracées à la source.',
  },
  {
    icon: Grid3x3,
    title: 'Ferraillage',
    text: 'Aciers calculés par des règles déterministes versionnées.',
  },
  {
    icon: Calculator,
    title: 'Étude de prix',
    text: 'Décomposition complète du coût direct au prix final.',
  },
  {
    icon: FileDown,
    title: 'Rapports & Export',
    text: 'Excel, PDF, 3D — vos livrables en un clic.',
  },
];

export function LandingPage() {
  const token = useAuthStore((s) => s.token);

  return (
    <div className="min-h-screen bg-ink-950 text-white">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 lg:grid-cols-2">
        {/* Hero */}
        <div className="flex flex-col justify-between px-6 py-8 lg:px-12">
          <header className="flex items-center justify-between">
            <Logo variant="dark" size="md" />
            <nav className="flex items-center gap-3">
              {token ? (
                <Link to="/app">
                  <Button variant="primary" size="sm">
                    Espace de travail
                  </Button>
                </Link>
              ) : (
                <Link to="/login">
                  <Button variant="ghost" size="sm" className="text-white hover:bg-white/10">
                    Se connecter
                  </Button>
                </Link>
              )}
            </nav>
          </header>

          <main className="flex flex-1 flex-col justify-center py-12">
            <span className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-400">
              <Sparkles size={13} /> Assisté par l'IA, vérifié par l'humain
            </span>
            <h1 className="max-w-xl text-4xl font-black leading-tight tracking-tight sm:text-5xl">
              Le métré, la 3D, le ferraillage et l'étude de prix,{' '}
              <span className="text-brand-500">enfin réunis.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg text-slate-300">
              BatiOne transforme vos plans et CCTP en quantités, modèles 3D,
              plans de ferraillage et études de prix — chaque valeur reste
              traçable jusqu'à sa source.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register">
                <Button variant="primary" size="lg" rightIcon={<ArrowRight size={18} />}>
                  Démarrer gratuitement
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="outlineDark" size="lg">
                  J'ai déjà un compte
                </Button>
              </Link>
            </div>

            {/* Trust row */}
            <div className="mt-10 flex flex-wrap items-center gap-6 text-sm text-slate-400">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck size={16} className="text-brand-500" /> Données
                hébergées en Europe
              </span>
              <span className="inline-flex items-center gap-2">
                <Users size={16} className="text-brand-500" /> +2 500
                professionnels
              </span>
              <span className="inline-flex items-center gap-2">
                <Clock size={16} className="text-brand-500" /> Support 24/7
              </span>
            </div>
          </main>

          {/* Feature strip */}
          <footer className="grid grid-cols-2 gap-3 border-t border-white/10 pt-6 sm:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex flex-col gap-1">
                <f.icon size={20} className="text-brand-500" />
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="text-xs text-slate-400">{f.text}</p>
              </div>
            ))}
          </footer>
        </div>

        {/* Signup card */}
        <div className="flex items-center justify-center bg-ink-900/40 px-6 py-10 lg:px-12">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 text-slate-900 shadow-2xl sm:p-8">
            <div className="mb-5 flex items-center gap-2">
              <Boxes size={20} className="text-brand-600" />
              <h2 className="text-xl font-bold">Créer votre espace</h2>
            </div>
            <RegisterForm />
          </div>
        </div>
      </div>
    </div>
  );
}
