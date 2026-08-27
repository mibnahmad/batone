import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authApi } from './lib/api';
import { useAuthStore } from './store/auth';
import { Toaster } from './components/layout/Toaster';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { ServiceWorkspacePage } from './pages/ServiceWorkspacePage';
import { NotFoundPage } from './pages/NotFoundPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Refresh the profile from the token on load; silently ignore failures. */
function useSyncProfile() {
  const token = useAuthStore((s) => s.token);
  const setProfile = useAuthStore((s) => s.setProfile);
  const { data } = useQuery({
    queryKey: ['me', token],
    queryFn: () => authApi.me(),
    enabled: Boolean(token),
    retry: false,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (data) setProfile({ user: data.user, organization: data.organization });
  }, [data, setProfile]);
}

export default function App() {
  useSyncProfile();

  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/projects/:projectId/:service"
          element={
            <ProtectedRoute>
              <ServiceWorkspacePage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Toaster />
    </>
  );
}
