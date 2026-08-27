import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Logo } from '../components/layout/Logo';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-ink-950 text-center text-white">
      <Logo variant="dark" size="lg" />
      <div>
        <p className="text-6xl font-black text-brand-500">404</p>
        <p className="mt-2 text-slate-300">Cette page n'existe pas.</p>
      </div>
      <Link to="/">
        <Button variant="primary">Retour à l'accueil</Button>
      </Link>
    </div>
  );
}
