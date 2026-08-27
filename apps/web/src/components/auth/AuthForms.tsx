import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { SsoButtons } from './SsoButtons';
import { PasswordChecklist, isPasswordValid } from './PasswordChecklist';
import { ROLE_OPTIONS } from '../../lib/constants';
import { useAuthActions } from '../../hooks/useAuth';

function Divider() {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-slate-200" />
      <span className="text-xs uppercase tracking-wide text-slate-400">ou</span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

export function RegisterForm() {
  const { register } = useAuthActions();
  const [form, setForm] = useState({
    organizationName: '',
    fullName: '',
    email: '',
    password: '',
    role: 'engineer',
  });

  const update = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const passwordOk = isPasswordValid(form.password);
  const canSubmit =
    form.organizationName.trim().length >= 2 &&
    form.fullName.trim().length >= 2 &&
    /.+@.+\..+/.test(form.email) &&
    passwordOk;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    register.mutate(form);
  };

  return (
    <div className="flex flex-col gap-4">
      <SsoButtons organizationName={form.organizationName} />
      <Divider />
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Input
          label="Organisation"
          name="organizationName"
          placeholder="Bureau d'études Dupont"
          value={form.organizationName}
          onChange={(e) => update('organizationName', e.target.value)}
          required
        />
        <Input
          label="Nom complet"
          name="fullName"
          placeholder="Jean Dupont"
          value={form.fullName}
          onChange={(e) => update('fullName', e.target.value)}
          required
        />
        <Input
          label="E-mail professionnel"
          name="email"
          type="email"
          placeholder="jean.dupont@exemple.fr"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
          required
        />
        <div className="flex flex-col gap-2">
          <Input
            label="Mot de passe"
            name="password"
            type="password"
            placeholder="••••••••"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
            required
          />
          <PasswordChecklist value={form.password} />
        </div>
        <Select
          label="Rôle"
          name="role"
          value={form.role}
          onChange={(e) => update('role', e.target.value)}
          options={ROLE_OPTIONS}
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="mt-1"
          loading={register.isPending}
          disabled={!canSubmit}
        >
          Créer mon compte
        </Button>
      </form>
      <p className="text-center text-sm text-slate-500">
        Déjà un compte ?{' '}
        <Link to="/login" className="font-semibold text-brand-600 hover:underline">
          Se connecter
        </Link>
      </p>
    </div>
  );
}

export function LoginForm() {
  const { login } = useAuthActions();
  const [form, setForm] = useState({ email: '', password: '' });

  const update = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const canSubmit = /.+@.+\..+/.test(form.email) && form.password.length > 0;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    login.mutate(form);
  };

  return (
    <div className="flex flex-col gap-4">
      <SsoButtons />
      <Divider />
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Input
          label="E-mail"
          name="email"
          type="email"
          placeholder="jean.dupont@exemple.fr"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
          required
        />
        <Input
          label="Mot de passe"
          name="password"
          type="password"
          placeholder="••••••••"
          value={form.password}
          onChange={(e) => update('password', e.target.value)}
          required
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="mt-1"
          loading={login.isPending}
          disabled={!canSubmit}
        >
          Se connecter
        </Button>
      </form>
      <p className="text-center text-sm text-slate-500">
        Pas encore de compte ?{' '}
        <Link
          to="/register"
          className="font-semibold text-brand-600 hover:underline"
        >
          Créer un compte
        </Link>
      </p>
    </div>
  );
}
