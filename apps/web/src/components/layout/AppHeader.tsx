import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, ChevronDown } from 'lucide-react';
import { Logo } from './Logo';
import { useAuthStore } from '../../store/auth';

export function AppHeader() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const organization = useAuthStore((s) => s.organization);
  const clear = useAuthStore((s) => s.clear);
  const [open, setOpen] = useState(false);

  const logout = () => {
    clear();
    navigate('/login');
  };

  const initials =
    user?.fullName
      ?.split(' ')
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() ?? '??';

  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
      <Link to="/app" className="flex items-center gap-3">
        <Logo variant="light" size="sm" />
        {organization && (
          <span className="hidden border-l border-slate-200 pl-3 text-sm font-medium text-slate-500 sm:inline">
            {organization.name}
          </span>
        )}
      </Link>

      <div className="relative" onMouseLeave={() => setOpen(false)}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-ink-950">
            {initials}
          </span>
          <span className="hidden text-sm font-medium text-slate-700 sm:inline">
            {user?.fullName ?? 'Utilisateur'}
          </span>
          <ChevronDown size={14} className="text-slate-400" />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="truncate text-sm font-medium text-slate-800">
                {user?.fullName}
              </p>
              <p className="truncate text-xs text-slate-400">{user?.email}</p>
            </div>
            <button
              onClick={logout}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            >
              <LogOut size={15} /> Se déconnecter
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
