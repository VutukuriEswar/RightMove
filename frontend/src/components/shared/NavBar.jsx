import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../hooks/useAuth';
import { useAuthStore } from '../../store/authStore';
import { useGameStore } from '../../store/gameStore';
import { useLeaveGameStore } from '../../store/leaveGameStore';
import { resignActiveGame, hasActiveGameResigner } from '../../lib/activeGameResign';
import { useNotifCounts } from '../../hooks/useNotifCounts';
import { useTrainingBadge } from '../../hooks/useTrainingBadge';
import { useThemeStore } from '../../store/themeStore';

export function NavBar() {
  const { user, isLoggedIn } = useAuth();
  const logout = useAuthStore((s) => s.logout);
  const { theme, toggleTheme } = useThemeStore();
  const navigate = useNavigate();
  const location = useLocation();
  const liveGameId = useGameStore((s) => s.gameId);
  const liveGameResult = useGameStore((s) => s.result);
  const openLeaveDialog = useLeaveGameStore((s) => s.openLeaveDialog);
  const closeLeaveDialog = useLeaveGameStore((s) => s.closeLeaveDialog);
  const setLeaving = useLeaveGameStore((s) => s.setLeaving);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const { friend_requests, challenge_requests } = useNotifCounts();
  const friendTotal = (friend_requests || 0) + (challenge_requests || 0);
  const trainingNew = useTrainingBadge(user?.role === 'admin');

  const inLiveGame = location.pathname.startsWith('/game/');

  const isActive = (path) => {
    if (path === '/lobby') return location.pathname === '/lobby' || location.pathname.startsWith('/game/') || location.pathname === '/paused';
    if (path === '/learn') return location.pathname.startsWith('/learn');
    if (path === '/events') return location.pathname.startsWith('/events');
    if (path === '/friends') return location.pathname.startsWith('/friends');
    if (path === '/history') return location.pathname.startsWith('/history') || location.pathname.startsWith('/review/');
    if (path === '/admin/users') return location.pathname.startsWith('/admin/users');
    if (path === '/admin/training') return location.pathname.startsWith('/admin/training');
    return location.pathname === path;
  };

  const handleLogout = () => {
    const inActiveGame =
      location.pathname.startsWith('/game/') && !!liveGameId && liveGameResult === null;
    if (inActiveGame && hasActiveGameResigner()) {
      openLeaveDialog({
        onConfirm: () => {
          setLeaving(true);
          resignActiveGame();
          closeLeaveDialog();
          logout();
          navigate('/login');
        },
        onCancel: () => closeLeaveDialog(),
      });
      return;
    }
    logout();
    navigate('/login');
  };

  if (inLiveGame) {
    return null;
  }

  return (
    <motion.nav
      className="navbar interactive"
      initial={{ opacity: 0, y: -50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 100, damping: 20, delay: 0.2 }}
    >
      <div className={`navbar-inner${menuOpen ? ' nav-open' : ''}`}>
        <Link to="/" className="navbar-logo interactive" onClick={() => setMenuOpen(false)}>
          <motion.span 
            className="navbar-logo-icon"
            whileHover={{ rotate: 360, scale: 1.2 }}
            transition={{ duration: 0.5 }}
          >
            ♞
          </motion.span>
          <span className="navbar-logo-text">RightMove</span>
        </Link>

        <button
          className="navbar-menu-btn interactive"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? '✕' : '☰'}
        </button>

        <ul className="navbar-links" role="navigation" aria-label="Main navigation">
          <li>
            <Link
              className={`interactive${isActive('/lobby') ? ' active' : ''}`}
              to="/lobby"
              onClick={() => setMenuOpen(false)}
            >
              Play
            </Link>
          </li>
          {isLoggedIn && (
            <li>
              <Link
                className={`interactive${isActive('/friends') ? ' active' : ''}`}
                to="/friends"
                onClick={() => setMenuOpen(false)}
              >
                Friends
                {friendTotal > 0 && (
                  <span className="nav-badge">
                    {friendTotal > 99 ? '99+' : friendTotal}
                  </span>
                )}
              </Link>
            </li>
          )}
          <li>
            <Link
              className={`interactive${isActive('/learn') ? ' active' : ''}`}
              to="/learn"
              onClick={() => setMenuOpen(false)}
            >
              Learn
            </Link>
          </li>
          <li>
            <Link
              className={`interactive${isActive('/events') ? ' active' : ''}`}
              to="/events"
              onClick={() => setMenuOpen(false)}
            >
              Events
            </Link>
          </li>
          {isLoggedIn && (
            <li>
              <Link
                className={`interactive${isActive('/history') ? ' active' : ''}`}
                to="/history"
                onClick={() => setMenuOpen(false)}
              >
                History
              </Link>
            </li>
          )}
          {isLoggedIn && user?.role === 'admin' && (
            <>
              <li>
                <Link
                  className={`interactive${isActive('/admin/users') ? ' active' : ''}`}
                  to="/admin/users"
                  onClick={() => setMenuOpen(false)}
                >
                  Users
                </Link>
              </li>
              <li>
                <Link
                  className={`interactive${isActive('/admin/training') ? ' active' : ''}`}
                  to="/admin/training"
                  onClick={() => setMenuOpen(false)}
                >
                  Training
                  {trainingNew > 0 && (
                    <span className="nav-badge">
                      {trainingNew > 99 ? '99+' : trainingNew}
                    </span>
                  )}
                </Link>
              </li>
            </>
          )}
        </ul>

        <div className="navbar-auth">
          <button 
            type="button"
            className="theme-toggle interactive" 
            onClick={toggleTheme} 
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          
          {isLoggedIn ? (
            <>
              <Link
                to="/profile"
                className={`navbar-user interactive${location.pathname === '/profile' ? ' active' : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                <span className="navbar-avatar">
                  {user?.avatar_url
                    ? <img src={user.avatar_url} alt={user.username} />
                    : <span>{user?.username?.[0]?.toUpperCase()}</span>
                  }
                </span>
                <span className="navbar-username">{user?.username}</span>
              </Link>
              <button
                type="button"
                className="btn-neon interactive"
                onClick={handleLogout}
                aria-label="Log out"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-neon btn-neon-secondary interactive">Log in</Link>
              <Link to="/signup" className="btn-neon interactive">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </motion.nav>
  );
}
