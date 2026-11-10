import React from 'react';
import { createBrowserRouter, RouterProvider, Navigate, useLocation, useOutlet } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useAuth } from './hooks/useAuth';
import { useGameSession } from './hooks/useGameSession';
import { NavBar } from './components/shared/NavBar';
import LeaveGameDialog from './components/game/LeaveGameDialog';
import GameSessionDialog from './components/game/GameSessionDialog';
import { GlobalCanvas } from './components/3d/GlobalCanvas';
import CustomCursor from './components/shared/CustomCursor';
import Home from './pages/Home';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Lobby from './pages/Lobby';
import PausedGames from './pages/PausedGames';
import GameRoom from './pages/GameRoom';
import Review from './pages/Review';

import Friends from './pages/Friends';
import Profile from './pages/Profile';
import MatchHistory from './pages/MatchHistory';
import SharedReview from './pages/SharedReview';
import Learn from './pages/Learn';
import Events from './pages/Events';
import AdminUsers from './pages/AdminUsers';
import AdminTraining from './pages/AdminTraining';
import { useAuthStore } from './store/authStore';
function RequireAuth({ children }) {
  const { isLoggedIn } = useAuth();
  return isLoggedIn ? children : <Navigate to="/login" replace />;
}
function RequireAdmin({ children }) {
  const { isLoggedIn } = useAuth();
  const user = useAuthStore((s) => s.user);
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (user?.role !== 'admin') return <Navigate to="/lobby" replace />;
  return children;
}

function AnimatedLayout() {
  const location = useLocation();
  const outlet = useOutlet();

  return (
    <AnimatePresence mode="wait">
      <div key={`${location.pathname}${location.hash}`} style={{ display: 'contents' }}>
        {outlet}
      </div>
    </AnimatePresence>
  );
}

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/login', element: <Login /> },
      { path: '/signup', element: <Signup /> },
      { path: '/lobby', element: <RequireAuth><Lobby /></RequireAuth> },
      { path: '/paused', element: <RequireAuth><PausedGames /></RequireAuth> },
      { path: '/game/:id', element: <RequireAuth><GameRoom /></RequireAuth> },
      { path: '/review/:id', element: <RequireAuth><Review /></RequireAuth> },
      { path: '/friends', element: <RequireAuth><Friends /></RequireAuth> },
      { path: '/profile', element: <RequireAuth><Profile /></RequireAuth> },
      { path: '/history', element: <RequireAuth><MatchHistory /></RequireAuth> },
      { path: '/learn', element: <RequireAuth><Learn /></RequireAuth> },
      { path: '/events', element: <Events /> },
      { path: '/events/:tourId', element: <Events /> },
      { path: '/admin/users', element: <RequireAdmin><AdminUsers /></RequireAdmin> },
      { path: '/admin/training', element: <RequireAdmin><AdminTraining /></RequireAdmin> },
      { path: '/shared/:id', element: <SharedReview /> },
    ],
  },
]);

function AppShell() {
  useGameSession();
  return (
    <>
      <GlobalCanvas />
      <CustomCursor />
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <NavBar />
        <AnimatedLayout />
        <LeaveGameDialog />
        <GameSessionDialog />
      </div>
    </>
  );
}

function App() {
  return <RouterProvider router={router} />;
}

export default App;
