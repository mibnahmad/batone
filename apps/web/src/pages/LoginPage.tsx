import { Navigate } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { LoginForm } from '../components/auth/AuthForms';
import { useAuthStore } from '../store/auth';

export function LoginPage() {
  const token = useAuthStore((s) => s.token);
  if (token) return <Navigate to="/app" replace />;
  return (
    <AuthShell
      title="Connexion"
      subtitle="Accédez à vos projets et à vos livrables."
    >
      <LoginForm />
    </AuthShell>
  );
}
