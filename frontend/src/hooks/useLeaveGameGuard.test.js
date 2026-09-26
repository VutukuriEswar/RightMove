import { render, screen, act } from '@testing-library/react';
import { BrowserRouter, createMemoryRouter, RouterProvider } from 'react-router-dom';
import { useLeaveGameGuard } from './useLeaveGameGuard';
import { useGameStore } from '../store/gameStore';
import { useLeaveGameStore } from '../store/leaveGameStore';

function GuardHost({ onResign }) {
  const node = useLeaveGameGuard(onResign);
  return (
    <>
      {node}
      <div>host-ok</div>
    </>
  );
}

function resetStores() {
  useGameStore.setState({ gameId: null, mode: null, result: null });
  useLeaveGameStore.setState({ isOpen: false, onConfirm: null, onCancel: null });
}

beforeEach(resetStores);

test('does not crash inside a plain (non-data) router', () => {
  render(
    <BrowserRouter>
      <GuardHost onResign={() => {}} />
    </BrowserRouter>
  );
  expect(screen.getByText('host-ok')).toBeInTheDocument();
});

test('does not block navigation when no live game is active (data router)', async () => {
  const router = createMemoryRouter(
    [
      { path: '/lobby', element: <GuardHost onResign={() => {}} /> },
      { path: '/profile', element: <div>profile-ok</div> },
    ],
    { initialEntries: ['/lobby'] }
  );
  render(<RouterProvider router={router} />);
  expect(screen.getByText('host-ok')).toBeInTheDocument();

  await act(async () => {
    await router.navigate('/profile');
  });
  expect(router.state.location.pathname).toBe('/profile');
  expect(screen.getByText('profile-ok')).toBeInTheDocument();
});

test('blocks navigation away from a live game, cancel stays, confirm resigns + proceeds', async () => {
  const resign = jest.fn();
  useGameStore.setState({ gameId: 'g1', mode: 'friend', result: null });
  const router = createMemoryRouter(
    [
      { path: '/game/:id', element: <GuardHost onResign={resign} /> },
      { path: '/lobby', element: <div>lobby-ok</div> },
    ],
    { initialEntries: ['/game/g1'] }
  );
  render(<RouterProvider router={router} />);
  expect(screen.getByText('host-ok')).toBeInTheDocument();

  await act(async () => {
    await router.navigate('/lobby');
  });
  expect(router.state.location.pathname).toBe('/game/g1');
  expect(useLeaveGameStore.getState().isOpen).toBe(true);

  await act(async () => {
    useLeaveGameStore.getState().onCancel();
  });
  expect(useLeaveGameStore.getState().isOpen).toBe(false);
  expect(router.state.location.pathname).toBe('/game/g1');
  expect(resign).not.toHaveBeenCalled();

  await act(async () => {
    await router.navigate('/lobby');
  });
  expect(useLeaveGameStore.getState().isOpen).toBe(true);
  await act(async () => {
    useLeaveGameStore.getState().onConfirm();
  });
  expect(resign).toHaveBeenCalledTimes(1);
  expect(useLeaveGameStore.getState().isOpen).toBe(false);
  expect(router.state.location.pathname).toBe('/lobby');
  expect(screen.getByText('lobby-ok')).toBeInTheDocument();
});

test('finished games (result set) are not blocked', async () => {
  useGameStore.setState({ gameId: 'g1', mode: 'friend', result: 'white' });
  const router = createMemoryRouter(
    [
      { path: '/game/:id', element: <GuardHost onResign={() => {}} /> },
      { path: '/lobby', element: <div>lobby-ok</div> },
    ],
    { initialEntries: ['/game/g1'] }
  );
  render(<RouterProvider router={router} />);

  await act(async () => {
    await router.navigate('/lobby');
  });
  expect(router.state.location.pathname).toBe('/lobby');
  expect(useLeaveGameStore.getState().isOpen).toBe(false);
});
