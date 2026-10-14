import React, { Component, useCallback, useContext, useEffect, useRef } from 'react';
import {
  useBlocker,
  useLocation,
  UNSAFE_DataRouterContext as DataRouterContext,
} from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import { useLeaveGameStore } from '../store/leaveGameStore';

function RouteBlocker({ active, onBlocked }) {
  const blocker = useBlocker(active);
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;

  useEffect(() => {
    if (blocker.state === 'blocked') {
      onBlockedRef.current?.(blocker);
    }
  }, [blocker]);

  return null;
}

class RouteBlockerBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[useLeaveGameGuard] in-app navigation blocking disabled:', error?.message);
    }
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export function useLeaveGameGuard(resignAndClose) {
  const location = useLocation();
  const gameId = useGameStore((s) => s.gameId);
  const result = useGameStore((s) => s.result);
  const openLeaveDialog = useLeaveGameStore((s) => s.openLeaveDialog);
  const closeLeaveDialog = useLeaveGameStore((s) => s.closeLeaveDialog);

  const onLiveGameRoute = location.pathname.startsWith('/game/');
  const guardActive = onLiveGameRoute && !!gameId && result === null;

  const hasDataRouter = useContext(DataRouterContext) != null;

  const resignRef = useRef(resignAndClose);
  resignRef.current = resignAndClose;

  const handleBlocked = useCallback((blocker) => {
    openLeaveDialog({
      onConfirm: () => {
        try {
          useLeaveGameStore.getState().setLeaving(true);
        } catch (_) {
        }
        try {
          resignRef.current?.();
        } catch (_) {
        }
        closeLeaveDialog();
        blocker.proceed();
      },
      onCancel: () => {
        closeLeaveDialog();
        blocker.reset();
      },
    });
  }, [openLeaveDialog, closeLeaveDialog]);
  const handleBlockedRef = useRef(handleBlocked);
  handleBlockedRef.current = handleBlocked;
  const stableOnBlocked = useCallback((blocker) => handleBlockedRef.current(blocker), []);

  useEffect(() => {
    if (!guardActive) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onPageHide = () => {
      try {
        resignRef.current?.();
      } catch (_) {
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [guardActive]);

  if (!hasDataRouter) return null;

  return (
    <RouteBlockerBoundary>
      <RouteBlocker active={guardActive} onBlocked={stableOnBlocked} />
    </RouteBlockerBoundary>
  );
}
