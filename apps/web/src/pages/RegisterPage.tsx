import { Navigate } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { RegisterForm } from '../components/auth/AuthForms';
import { useAuthStore } from '../store/auth';

export function RegisterPage() {
  const token = useAuthStore((s) => s.token);
  if (token) return <Navigate to="/app" replace />;
  return (
    <AuthShell
      title="Créer un compte"
      subtitle="Configurez votre organisation en quelques secondes."
    >
      <RegisterForm />
    </AuthShell>
  );
}
