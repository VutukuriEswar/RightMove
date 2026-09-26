import {
  encodeSharePayload,
  decodeSharePayload,
  slimGameForShare,
  buildShareUrl,
  copyTextToClipboard,
} from './chessUtils';

describe('share-link codec', () => {
  test('round-trips a game incl. unicode opponent names', () => {
    const game = {
      game_id: 'abc-123',
      moves: [{ uci: 'e2e4', san: 'e4', elapsed_ms: 1200 }, { uci: 'e7e5', san: 'e5' }],
      result: 'white',
      mode: 'bot',
      opponent: 'Müller ♞',
      saved_at: 1720000000000,
    };
    const url = buildShareUrl(game);
    expect(url.startsWith('http')).toBe(true);
    const fragment = url.split('#')[1];
    expect(fragment).not.toMatch(/[+/=]/);
    const parsed = decodeSharePayload(fragment);
    expect(parsed.id).toBe('abc-123');
    expect(parsed.meta.opponent).toBe('Müller ♞');
    expect(parsed.moves).toEqual([{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }]);
  });

  test('tolerates percent-encoded fragments and missing padding', () => {
    const raw = encodeSharePayload({ id: 'x', moves: [], meta: {} });
    const mangled = encodeURIComponent(raw).replace(/=+$/, '');
    expect(decodeSharePayload(mangled)).toEqual({ id: 'x', moves: [], meta: {} });
  });

  test('rejects garbage with a throw (caller shows friendly error)', () => {
    expect(() => decodeSharePayload('!!!not-base64!!!')).toThrow();
    expect(() => decodeSharePayload('')).toThrow();
  });

  test('slimGameForShare handles missing moves', () => {
    expect(slimGameForShare({ game_id: 'g' }).moves).toEqual([]);
  });

  test('copyTextToClipboard never throws, resolves boolean', async () => {
    await expect(copyTextToClipboard('http://x/#y')).resolves.toEqual(expect.any(Boolean));
  });
});
