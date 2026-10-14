import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../hooks/useAuth';
import { useAuthStore } from '../../store/authStore';
import { useGameStore } from '../../store/gameStore';
import { useLeaveGameStore } from '../../store/leaveGameStore';
import { resignActiveGame, hasActiveGameResigner } from '../../lib/activeGameResign';
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

  const handleLogout = () => {
    const inLiveGame =
      location.pathname.startsWith('/game/') && !!liveGameId && liveGameResult === null;
    if (inLiveGame && hasActiveGameResigner()) {
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

        {isLoggedIn && (
          <button
            className="navbar-menu-btn interactive"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        )}

        <ul className="navbar-links" role="navigation" aria-label="Main navigation">
          {isLoggedIn && (
            <>
              <li><Link className="interactive" to="/lobby" onClick={() => setMenuOpen(false)}>Play</Link></li>
              <li><Link className="interactive" to="/friends" onClick={() => setMenuOpen(false)}>Friends</Link></li>
              <li><Link className="interactive" to="/learn" onClick={() => setMenuOpen(false)}>Learn</Link></li>
              <li><Link className="interactive" to="/history" onClick={() => setMenuOpen(false)}>History</Link></li>
              {user?.role === 'admin' && (
                <>
                  <li><Link className="interactive" to="/admin/users" onClick={() => setMenuOpen(false)}>Users</Link></li>
                  <li><Link className="interactive" to="/admin/training" onClick={() => setMenuOpen(false)}>Training</Link></li>
                </>
              )}
            </>
          )}
        </ul>

        <div className="navbar-auth">
          <button 
            className="theme-toggle interactive" 
            onClick={toggleTheme} 
            aria-label="Toggle theme"
            style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', padding: '0 8px', color: 'var(--royal-ink)' }}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          
          {isLoggedIn ? (
            <>
              <Link to="/profile" className="navbar-user interactive">
                <span className="navbar-avatar">
                  {user?.avatar_url
                    ? <img src={user.avatar_url} alt={user.username} />
                    : <span>{user?.username?.[0]?.toUpperCase()}</span>
                  }
                </span>
                <span className="navbar-username">{user?.username}</span>
              </Link>
              <button
                className="btn-neon interactive"
                onClick={handleLogout}
                aria-label="Log out"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-neon interactive" style={{ borderColor: 'var(--royal-gold, #D4AF37)', color: 'var(--royal-gold, #D4AF37)' }}>Log in</Link>
              <Link to="/signup" className="btn-neon interactive">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </motion.nav>
  );
}
