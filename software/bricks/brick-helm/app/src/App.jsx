import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { LocaleProvider } from './context/LocaleContext.jsx';
import { SettingsProvider } from './context/SettingsContext.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import AdminAgent from './pages/admin/AdminAgent.jsx';
import AdminCli from './pages/admin/AdminCli.jsx';
import AdminBriefing from './pages/admin/AdminBriefing.jsx';
import AdminVoices from './pages/admin/AdminVoices.jsx';
import AdminVoiceAliases from './pages/admin/AdminVoiceAliases.jsx';
import {
  AdminUsersList,
  AdminUsersCreate,
  AdminUsersEdit,
} from './pages/admin/AdminUsers.jsx';
import AdminMaestro from './pages/admin/AdminMaestro.jsx';
import AdminSocle from './pages/admin/AdminSocle.jsx';
import { I18nProvider } from './i18n/index.jsx';
import Layout from './components/Layout.jsx';
import OperatorLocaleSync from './components/OperatorLocaleSync.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { useAppBootstrap } from './hooks/useAppBootstrap.js';
import { canAccessDemoLimitedAdmin, demoAdminAllowedPaths } from './lib/demoAdminAccess.js';

function ProtectedLayout() {
  const { loading, authenticated } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen mesh-bg flex items-center justify-center text-slate-400">
        Chargement…
      </div>
    );
  }
  if (!authenticated) {
    const from = `${location.pathname}${location.search}`;
    const qs = from && from !== '/'
      ? `?next=${encodeURIComponent(from)}`
      : '';
    return <Navigate to={`/${qs}`} replace />;
  }
  return (
    <SettingsProvider>
      <OperatorLocaleSync />
      <Layout />
    </SettingsProvider>
  );
}

function AdminShell() {
  const { loading, user } = useAuth();
  const location = useLocation();
  const { isDemo, loading: bootLoading } = useAppBootstrap();

  if (loading || bootLoading) {
    return (
      <div className="min-h-screen mesh-bg flex items-center justify-center text-slate-400">
        Chargement…
      </div>
    );
  }

  const isAdmin = user?.role === 'admin';
  const allowedPaths = demoAdminAllowedPaths(user, isDemo);

  if (!isAdmin && !canAccessDemoLimitedAdmin(user, isDemo)) {
    return <Navigate to="/console" replace />;
  }

  if (allowedPaths && !allowedPaths.some((p) => location.pathname.startsWith(p))) {
    return <Navigate to={allowedPaths[0].replace('/admin/', '')} replace />;
  }

  return (
    <>
      <OperatorLocaleSync />
      <AdminLayout allowedTabPaths={allowedPaths} />
    </>
  );
}

function AdminIndexRedirect() {
  const { user } = useAuth();
  const { isDemo, loading: bootLoading } = useAppBootstrap();

  if (bootLoading) {
    return (
      <div className="flex justify-center py-16 text-slate-500">
        Chargement…
      </div>
    );
  }

  const isAdmin = user?.role === 'admin';
  const allowedPaths = demoAdminAllowedPaths(user, isDemo);
  if (!isAdmin && allowedPaths?.length) {
    const first = allowedPaths[0].replace(/^\/admin\//, '');
    return <Navigate to={first} replace />;
  }
  return <Navigate to="agent" replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <I18nProvider>
        <LocaleProvider>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route path="/" element={<Login />} />
                <Route element={<ProtectedLayout />}>
                  <Route path="/console/*" element={<Dashboard />} />
                  <Route path="/console" element={<Dashboard />} />
                  <Route path="/talk" element={<Navigate to="/console" replace />} />
                  <Route path="/voice" element={<Navigate to="/console" replace />} />
                  <Route path="/admin" element={<AdminShell />}>
                    <Route index element={<AdminIndexRedirect />} />
                    <Route path="maestro" element={<AdminMaestro />} />
                    <Route path="socle" element={<AdminSocle />} />
                    <Route path="agent" element={<AdminAgent />} />
                    <Route path="cli" element={<AdminCli />} />
                    <Route path="briefing" element={<AdminBriefing />} />
                    <Route path="voices" element={<AdminVoices />} />
                    <Route path="voice-aliases" element={<AdminVoiceAliases />} />
                    <Route path="users" element={<AdminUsersList />} />
                    <Route path="users/new" element={<AdminUsersCreate />} />
                    <Route path="users/:id" element={<AdminUsersEdit />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </LocaleProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}
