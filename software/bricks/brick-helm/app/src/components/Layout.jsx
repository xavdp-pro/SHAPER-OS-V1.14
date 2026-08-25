import { Outlet } from 'react-router-dom';

/** Full-screen shell — the sidebar lives inside Dashboard. */
export default function Layout() {
  return (
    <div className="h-dvh max-h-dvh w-full max-w-full mesh-bg overflow-hidden">
      <Outlet />
    </div>
  );
}
