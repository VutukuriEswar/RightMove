import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Board2D from '../components/board/Board2D';
import GmChallenge from '../components/game/GmChallenge';
import { learnApi } from '../lib/api';
import { useCurriculum } from '../hooks/useCurriculum';
import WeaknessCard from '../components/curriculum/WeaknessCard';
import AgentReport from '../components/curriculum/AgentReport';
import ImprovementChart from '../components/curriculum/ImprovementChart';

const fadeUp = {
  hidden: { opacity: 0, y: 26 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 90, damping: 18 } },
};

const PIECES = [
  { glyph: '♚', name: 'King', value: '∞', move: 'One square any direction. Guard him with your life — checkmate ends the game.' },
  { glyph: '♛', name: 'Queen', value: '9', move: 'Any squares along ranks, files and diagonals. The strongest piece.' },
  { glyph: '♜', name: 'Rook', value: '5', move: 'Any squares along ranks and files. Loves open lines and the 7th rank.' },
  { glyph: '♝', name: 'Bishop', value: '3.3', move: 'Any squares diagonally. Keep the pair to rule both colors.' },
  { glyph: '♞', name: 'Knight', value: '3.2', move: 'Jumps in an L. Deadly in the center, dim on the rim.' },
  { glyph: '♟', name: 'Pawn', value: '1', move: 'Steps forward, captures diagonally. March it home to promote.' },
];

const CONCEPTS = [
  { icon: '👑', title: 'The goal', text: 'Checkmate the enemy king — attack it so it has no legal escape.' },
  { icon: '⚔️', title: 'White moves first', text: 'White always opens. Players then alternate exactly one move each.' },
  { icon: '⚠️', title: 'Check', text: 'Your king is attacked. You must move it, block, or capture — immediately.' },
  { icon: '🤝', title: 'Draws', text: 'Stalemate (no legal move, not in check), repetition, or mutual agreement split the point.' },
  { icon: '🏰', title: 'Castling', text: 'King + rook glide to safety together: O-O kingside, O-O-O queenside.' },
  { icon: '🎖️', title: 'Promotion', text: 'A pawn reaching the far rank becomes a queen (usually), rook, bishop or knight.' },
];

const CLASS_COLORS = {
  'Best Move': 'cls-best', 'Excellent': 'cls-excellent', 'Good': 'cls-good',
  'Inaccuracy': 'cls-inaccuracy', 'Mistake': 'cls-mistake', 'Blunder': 'cls-blunder',
};

const TABS = [
  { id: 'curriculum', label: '🎯 My Weaknesses', icon: '🎯' },
  { id: 'basics', label: '♟ Basics', icon: '♟' },
  { id: 'notation', label: '🗺 Squares', icon: '🗺' },
  { id: 'pgn', label: '📂 PGN Lab', icon: '📂' },
  { id: 'position', label: '♟ Position Lab', icon: '♟' },
  { id: 'gm', label: '🏛 Think Like a GM', icon: '🏛' },
];

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const CORE = new Set(['d4', 'e4', 'd5', 'e5']);
const EXTENDED = new Set(['c4', 'd3', 'e3', 'f4', 'c5', 'd6', 'e6', 'f5']);

function CoordinateBoard({ highlight }) {
  const squares = [];
  for (let r = 8; r >= 1; r--) {
    for (let f = 0; f < 8; f++) {
      const name = `${FILES[f]}${r}`;
      const cls = CORE.has(name) ? 'sq-core' : EXTENDED.has(name) ? 'sq-ext' : '';
      const hl = highlight?.from === name ? 'hl-from' : highlight?.to === name ? 'hl-to' : '';
      squares.push(
        <div key={name} className={`coord-sq ${(r + f) % 2 === 0 ? 'sq-dark' : 'sq-light'} ${cls} ${hl}`}>
          {f === 0 && <span className="coord-rank">{r}</span>}
          {r === 1 && <span className="coord-file">{FILES[f]}</span>}
          {CORE.has(name) && !hl && <span className="coord-star">★</span>}
          {hl === 'hl-to' && <span className="coord-pin">●</span>}
        </div>
      );
    }
  }
  return <div className="coord-board">{squares}</div>;
}

const MOVE_GROUPS = [
  {
    title: 'Pawn moves',
    moves: [
      { san: 'e4', uci: 'e2e4', from: 'e2', to: 'e4', blurb: 'No letter means pawn. It marches two squares from its start.', parts: ['pawn', '→ e4'] },
      { san: 'e5', uci: 'e7e5', from: 'e7', to: 'e5', blurb: 'Black answers the same way. One step or two on its first move.', parts: ['pawn', '→ e5'] },
      { san: 'd4', uci: 'd2d4', from: 'd2', to: 'd4', blurb: 'The other classic opener — d-file pawn claims the center.', parts: ['pawn', '→ d4'] },
      { san: 'exd5', uci: 'e4d5', from: 'e4', to: 'd5', blurb: 'Pawn capture: file it leaves + × + landing square.', parts: ['e = from e-file', '× captures', '→ d5'] },
      { san: 'exd6 e.p.', uci: 'e5d6', from: 'e5', to: 'd6', blurb: 'En passant: a pawn capturing one that just double-stepped past it.', parts: ['e = from e-file', '× captures', '→ d6', 'e.p. special rule'] },
      { san: 'e8=Q', uci: 'e7e8q', from: 'e7', to: 'e8', blurb: 'Promotion: a pawn reaching the last rank becomes (usually) a queen.', parts: ['pawn → e8', '=Q becomes queen'] },
    ],
  },
  {
    title: 'Piece moves',
    moves: [
      { san: 'Nf3', uci: 'g1f3', from: 'g1', to: 'f3', blurb: 'Piece letter + destination. N is Knight (K is taken by the King).', parts: ['N = Knight', '→ f3'] },
      { san: 'Nc6', uci: 'b8c6', from: 'b8', to: 'c6', blurb: 'Black develops: Knight to its best square, eyeing d4 and e5.', parts: ['N = Knight', '→ c6'] },
      { san: 'Bb5', uci: 'f1b5', from: 'f1', to: 'b5', blurb: 'Bishops glide diagonally — here pinning the c6-knight.', parts: ['B = Bishop', '→ b5'] },
      { san: 'Qh5', uci: 'd1h5', from: 'd1', to: 'h5', blurb: 'Q is Queen. Early queen trips like this are risky — she can be chased.', parts: ['Q = Queen', '→ h5'] },
      { san: 'Bxf7+', uci: 'c4f7', from: 'c4', to: 'f7', blurb: 'Piece capture with check: × takes on f7, + attacks the king.', parts: ['B = Bishop', '× captures', '→ f7', '+ = check'] },
      { san: 'Nbd7', uci: 'b8d7', from: 'b8', to: 'd7', blurb: 'Disambiguation: two knights could reach d7, so the b-file one is named.', parts: ['N = Knight', 'b = from b-file', '→ d7'] },
      { san: 'R1e2', uci: 'e1e2', from: 'e1', to: 'e2', blurb: 'Same idea with ranks: the rook from rank 1 (not rank 8) slides to e2.', parts: ['R = Rook', '1 = from rank 1', '→ e2'] },
    ],
  },
  {
    title: 'Special moves',
    moves: [
      { san: 'O-O', uci: 'e1g1', from: 'e1', to: 'g1', blurb: 'Kingside castling: king hops two squares, rook jumps over.', parts: ['O-O = short castle', 'king e1 → g1'] },
      { san: 'O-O-O', uci: 'e1c1', from: 'e1', to: 'c1', blurb: 'Queenside castling: the long walk — king to c1, rook to d1.', parts: ['O-O-O = long castle', 'king e1 → c1'] },
      { san: 'Qxf7#', uci: 'h5f7', from: 'h5', to: 'f7', blurb: 'Scholar\u2019s mate: queen captures on f7 and it is checkmate (#).', parts: ['Q = Queen', '× captures', '→ f7', '# = checkmate'] },
    ],
  },
];

const SUFFIX_LEGEND = [
  { sym: '×  x', mean: 'captures on that square' },
  { sym: '+', mean: 'check — the king is attacked' },
  { sym: '#', mean: 'checkmate — game over' },
  { sym: '=', mean: 'promotion — e8=Q means becomes a queen' },
  { sym: 'O-O', mean: 'kingside castling' },
  { sym: 'O-O-O', mean: 'queenside castling' },
  { sym: 'e.p.', mean: 'en passant, the special pawn capture' },
  { sym: '!  ?', mean: 'great move / mistake (annotations)' },
];

const PIECE_LETTERS = [
  { sym: 'K', mean: 'King' },
  { sym: 'Q', mean: 'Queen' },
  { sym: 'R', mean: 'Rook' },
  { sym: 'B', mean: 'Bishop' },
  { sym: 'N', mean: 'kNight' },
  { sym: '(none)', mean: 'pawn' },
];

function ProsCons({ advantages = [], disadvantages = [], title = 'This move' }) {
  return (
    <div className="pros-cons">
      <h4 className="lab-h" style={{ marginTop: 12 }}>{title} — advantages & disadvantages</h4>
      <div className="pros-cons-grid">
        <div className="pros-box">
          <strong>✅ Advantages</strong>
          {(advantages.length ? advantages : ['No clear positional gain.']).map((a, i) => (
            <p key={i} className="pros-line">• {a}</p>
          ))}
        </div>
        <div className="cons-box">
          <strong>⚠️ Disadvantages</strong>
          {(disadvantages.length ? disadvantages : ['No clear positional harm.']).map((d, i) => (
            <p key={i} className="pros-line">• {d}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

function ParamRow({ p }) {
  const diff = Math.round(p.diff);
  const total = Math.abs(Math.round(p.white)) + Math.abs(Math.round(p.black)) || 1;
  const wPct = Math.min(100, (Math.abs(Math.round(p.white)) / total) * 100);
  return (
    <div className="learn-param">
      <div className="learn-param-head">
        <span className="learn-param-name">{p.name}</span>
        <span className={`learn-param-diff ${diff > 0 ? 'pw' : diff < 0 ? 'pb' : ''}`}>
          {diff > 0 ? '+' : ''}{diff}
        </span>
      </div>
      <div className="learn-param-bar">
        <div className="learn-param-w" style={{ width: `${wPct}%` }} />
      </div>
      <div className="learn-param-vals">⚪ {Math.round(p.white)} &nbsp;|&nbsp; ⚫ {Math.round(p.black)}</div>
    </div>
  );
}

export default function Learn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState(searchParams.get('tab') || 'curriculum');
  const [expandedBannerReport, setExpandedBannerReport] = useState(false);

  const {
    clusters,
    pendingDrills,
    unreadReports,
    progressData,
    fetchProgress,
    acknowledgeReport,
  } = useCurriculum();

  useEffect(() => {
    fetchProgress();
    const tabParam = searchParams.get('tab');
    if (tabParam) {
      setTab(tabParam);
      document.getElementById(`learn-${tabParam}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searchParams, fetchProgress]);

  const unreadCluster = clusters.find((c) => c.latest_report && !c.latest_report.acknowledged_by_user);
  const unreadReport = unreadCluster?.latest_report || null;

  const [moveSel, setMoveSel] = useState(MOVE_GROUPS[0].moves[0]);
  const [pgnFile, setPgnFile] = useState(null);
  const [pgnBusy, setPgnBusy] = useState(false);
  const [pgnError, setPgnError] = useState(null);
  const [pgnData, setPgnData] = useState(null);
  const [gameIdx, setGameIdx] = useState(0);
  const [plyIdx, setPlyIdx] = useState(0);

  const [fenInput, setFenInput] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [posBusy, setPosBusy] = useState(false);
  const [posError, setPosError] = useState(null);
  const [posData, setPosData] = useState(null);

  const scrollTo = (id) => {
    setTab(id);
    document.getElementById(`learn-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const analyzePgn = async () => {
    if (!pgnFile) return;
    setPgnBusy(true); setPgnError(null); setPgnData(null);
    try {
      const data = await learnApi.analyzePgn(pgnFile);
      setPgnData(data);
      const first = (data.games || []).find((g) => g.moves?.length) || data.games?.[0];
      setGameIdx(first?.index ?? 0); setPlyIdx(0);
    } catch (e) { setPgnError(e.message || 'PGN analysis failed'); }
    finally { setPgnBusy(false); }
  };

  const analyzeFen = async () => {
    if (!fenInput) return;
    setPosBusy(true); setPosError(null); setPosData(null);
    try {
      const data = await learnApi.analyzePosition(fenInput, 3);
      setPosData(data);
    } catch (e) { setPosError(e.message || 'Position analysis failed'); }
    finally { setPosBusy(false); }
  };

  const visibleGames = (pgnData?.games || []).filter((g) => g.moves?.length);
  const game = visibleGames.find((g) => g.index === gameIdx) || visibleGames[0] || pgnData?.games?.[gameIdx];
  const safePly = game?.moves?.length ? Math.max(0, Math.min(plyIdx, game.moves.length - 1)) : 0;
  const move = game?.moves?.[safePly];
  const boardFen = move?.fen_after || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const normPct = (v) => (Number.isFinite(v) ? (v <= 1.2 && v > 0 ? v * 100 : v) : v);
  const probsRaw = posData?.evaluation?.win_probabilities;
  const probs = probsRaw ? { white: normPct(probsRaw.white), draw: normPct(probsRaw.draw), black: normPct(probsRaw.black) } : null;

  const selectGame = (idx) => { setGameIdx(idx); setPlyIdx(0); };
  const stepPly = (delta) => {
    if (!game?.moves?.length) return;
    setPlyIdx((i) => Math.max(0, Math.min(game.moves.length - 1, (Number.isFinite(i) ? i : 0) + delta)));
  };

  return (
    <motion.div className="page learn-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

      <motion.div className="learn-hero" initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}>
        <div className="learn-crest">📚</div>
        <h1>Learn Chess</h1>
        <p>From your first moves to reading engines — rules, squares, and a laboratory for your own games.</p>
      </motion.div>

      <div className="learn-tabsbar glass-panel">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`learn-tab interactive ${tab === t.id ? 'active' : ''}`}
            onClick={() => scrollTo(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <motion.section id="learn-curriculum" className="glass-panel learn-section" variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}>
        <div className="learn-section-head">
          <span className="learn-kicker">Curriculum Engine</span>
          <h2>🎯 Personalized Weakness Training</h2>
          <p>
            An adaptive AI coach clustering your in-game mistakes, scheduling tailored spaced-repetition
            drills, and guiding your deliberate practice.
          </p>
        </div>

        {unreadReport && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.15), rgba(15, 23, 42, 0.9))',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: 14,
              padding: '18px 22px',
              marginBottom: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 8px 24px rgba(56, 189, 248, 0.15)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '1.4rem' }}>🔔</span>
                <div>
                  <div style={{ fontWeight: 700, color: '#38bdf8', fontSize: '0.95rem' }}>
                    New Coach Insight: {unreadCluster?.display_name || 'Weakness Analysis'}
                  </div>
                  <div style={{ color: '#e2e8f0', fontSize: '0.9rem', marginTop: 2 }}>
                    &ldquo;{unreadReport.pattern_name}&rdquo;
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary interactive"
                onClick={() => setExpandedBannerReport((v) => !v)}
                style={{ padding: '6px 14px', fontSize: '0.85rem' }}
              >
                {expandedBannerReport ? 'Collapse Report ↑' : 'Read Full Report ↓'}
              </button>
            </div>

            <AnimatePresence>
              {expandedBannerReport && (
                <AgentReport
                  report={unreadReport}
                  cluster={unreadCluster}
                  onDismiss={() => {
                    acknowledgeReport(unreadReport._id, unreadCluster?.cluster_id);
                    setExpandedBannerReport(false);
                  }}
                  onDrillNow={() => navigate(`/learn/drill?cluster=${encodeURIComponent(unreadCluster.cluster_id)}`)}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}

        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.15rem', fontWeight: 700 }}>
              Active Weakness Profiles
            </h3>
            {pendingDrills > 0 && (
              <button
                type="button"
                className="btn-neon interactive"
                onClick={() => navigate('/learn/drill')}
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
              >
                ⚡ Drill Due Positions ({pendingDrills})
              </button>
            )}
          </div>

          {clusters && clusters.length > 0 ? (
            <div>
              {clusters.map((c) => (
                <WeaknessCard key={c.cluster_id} cluster={c} />
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: '36px 24px',
                textAlign: 'center',
                background: 'rgba(15, 23, 42, 0.4)',
                borderRadius: 16,
                border: '1px dashed rgba(255, 255, 255, 0.12)',
              }}
            >
              <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: 10 }}>♟️</span>
              <h4 style={{ color: '#fff', fontSize: '1.1rem', margin: '0 0 6px 0' }}>
                No weaknesses logged yet
              </h4>
              <p style={{ color: '#94a3b8', fontSize: '0.9rem', maxWidth: 440, margin: '0 auto 16px auto', lineHeight: 1.5 }}>
                Play games against bots or friends. When 15+ tactical mistakes accumulate, our AI
                engine automatically groups them into recurring patterns with custom drills here.
              </p>
              <button
                type="button"
                className="btn-neon interactive"
                onClick={() => navigate('/lobby')}
                style={{ padding: '8px 18px' }}
              >
                Play a Game →
              </button>
            </div>
          )}
        </div>

        <div>
          <h3 style={{ margin: '0 0 14px 0', color: '#f8fafc', fontSize: '1.15rem', fontWeight: 700 }}>
            Progress Over Time
          </h3>
          <ImprovementChart clusters={progressData?.clusters || clusters} />
        </div>
      </motion.section>

      <motion.section id="learn-basics" className="glass-panel learn-section" variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}>
        <div className="learn-section-head">
          <span className="learn-kicker">Chapter I</span>
          <h2>Meet the army</h2>
          <p>Six pieces, six personalities. Values are in pawns — the engine prices every trade with them.</p>
        </div>
        <div className="piece-grid">
          {PIECES.map((p) => (
            <motion.div key={p.name} className="piece-card interactive" whileHover={{ y: -6, scale: 1.02 }}>
              <div className="piece-glyph">{p.glyph}</div>
              <div className="piece-name">{p.name}</div>
              <div className="piece-value">{p.value === '∞' ? 'priceless' : `${p.value} pts`}</div>
              <p>{p.move}</p>
            </motion.div>
          ))}
        </div>
        <div className="concept-grid">
          {CONCEPTS.map((c) => (
            <div key={c.title} className="concept-card">
              <span className="concept-icon">{c.icon}</span>
              <div>
                <strong>{c.title}</strong>
                <p>{c.text}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.section>

      <motion.section id="learn-notation" className="glass-panel learn-section" variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}>
        <div className="learn-section-head">
          <span className="learn-kicker">Chapter II</span>
          <h2>What do d4, d5… and every move mean?</h2>
          <p>Every square has an address: its <strong>file</strong> (a–h, left to right from White's view) plus its <strong>rank</strong> (1–8, White to Black). Every move is just a short code built from that address — tap any move below and watch it light up on the board.</p>
        </div>
        <div className="notation-split">
          <div className="notation-board">
            <CoordinateBoard highlight={moveSel ? { from: moveSel.from, to: moveSel.to } : null} />
            <div className="coord-legend">
              <span><i className="dot dot-core" /> Core center ★</span>
              <span><i className="dot dot-ext" /> Extended center</span>
              <span><i className="dot dot-move" /> Selected move</span>
            </div>
            {moveSel && (
              <div className="coord-readout">
                <strong>{moveSel.san}</strong>
                <span>from {moveSel.from} → to {moveSel.to} · engine writes it {moveSel.uci}</span>
              </div>
            )}
          </div>
          <div className="notation-text">
            <div className="notation-fact">
              <span className="notation-sq">d4</span>
              <p><strong>d-file, 4th rank</strong> — a central square on White's side. Opening pawns dream of living here.</p>
            </div>
            <div className="notation-fact">
              <span className="notation-sq">d5</span>
              <p><strong>d-file, 5th rank</strong> — one step deeper, into Black's half. Whoever holds these squares steers the game.</p>
            </div>
            <div className="notation-fact">
              <span className="notation-sq">a1–h8</span>
              <p><strong>Two alphabets:</strong> humans write SAN (<em>Nf3, exd5, O-O</em>); engines write UCI coordinates (<em>g1f3</em> = from g1 to f3).</p>
            </div>
            <div className="letter-grid">
              {PIECE_LETTERS.map((l) => (
                <span key={l.sym} className="letter-chip"><strong>{l.sym}</strong> {l.mean}</span>
              ))}
            </div>
          </div>
        </div>

        <h3 className="lab-h" style={{ marginTop: 22 }}>Suffixes — the punctuation of moves</h3>
        <div className="suffix-grid">
          {SUFFIX_LEGEND.map((s) => (
            <span key={s.sym} className="suffix-chip"><strong>{s.sym}</strong> {s.mean}</span>
          ))}
        </div>

        {MOVE_GROUPS.map((g) => (
          <div key={g.title}>
            <h3 className="lab-h" style={{ marginTop: 20 }}>{g.title}</h3>
            <div className="moves-grid">
              {g.moves.map((m) => (
                <button
                  key={m.san}
                  className={`nm-card interactive ${moveSel?.san === m.san ? 'active' : ''}`}
                  onClick={() => setMoveSel(m)}
                >
                  <span className="nm-san">{m.san}</span>
                  <span className="nm-uci">{m.uci}</span>
                  <p>{m.blurb}</p>
                  <span className="nm-fromto">{m.from} → {m.to}</span>
                  <div className="nm-parts">
                    {m.parts.map((p) => <span key={p} className="nm-part">{p}</span>)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </motion.section>

      <motion.section id="learn-pgn" className="glass-panel learn-section" variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}>
        <div className="learn-section-head">
          <span className="learn-kicker">Chapter III · Laboratory</span>
          <h2>📂 Dissect your games</h2>
          <p>Drop a <code>.pgn</code> with one or many games. Every single move is graded for <strong>both White and Black</strong> — hop between games and replay each decision.</p>
        </div>
        <label className={`dropzone interactive ${pgnFile ? 'has-file' : ''}`}>
          <input type="file" accept=".pgn,.txt" onChange={(e) => setPgnFile(e.target.files?.[0] || null)} hidden />
          <span className="dropzone-icon">📥</span>
          <span className="dropzone-text">{pgnFile ? pgnFile.name : 'Choose a PGN file…'}</span>
          <span className="dropzone-sub">{pgnFile ? `${(pgnFile.size / 1024).toFixed(1)} KB · ready` : 'petrosian-vs-fischer.pgn, my-games.pgn…'}</span>
        </label>
        <button className="btn-neon interactive learn-cta" onClick={analyzePgn} disabled={!pgnFile || pgnBusy}>
          {pgnBusy ? <><span className="spinner-inline" /> Analyzing every move…</> : '⚗️ Analyze PGN'}
        </button>
        {pgnError && <div className="alert alert-error">{pgnError}</div>}
        {pgnData && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <p className="learn-resultline"><strong>{pgnData.game_count}</strong> game(s) analyzed · pick a game, then step through it</p>
            <div className="game-pills">
              {visibleGames.map((g) => (
                <button key={g.index} type="button" className={`game-pill interactive ${g.index === gameIdx ? 'active' : ''}`}
                  onClick={() => selectGame(g.index)}>
                  <span className="game-pill-num">G{g.index + 1}</span>
                  <span className="game-pill-names">{g.headers.White} – {g.headers.Black}</span>
                  <span className="game-pill-res">{g.result}</span>
                </button>
              ))}
            </div>
            {game && (
              <div className="lab-split">
                <div className="lab-board">
                  <Board2D id="pgnLabBoard" fen={boardFen} disabled playerColor="white"
                    lastMove={move ? { from: move.uci.slice(0, 2), to: move.uci.slice(2, 4) } : null} />
                  <div className="stepper">
                    <button type="button" className="btn-sm interactive" disabled={!game.moves.length || safePly <= 0} onClick={() => stepPly(-1)}>← Prev</button>
                    <span className="stepper-count">{game.moves.length ? `${safePly + 1} / ${game.moves.length}` : 'no moves'}</span>
                    <button type="button" className="btn-sm interactive" disabled={!game.moves.length || safePly >= game.moves.length - 1} onClick={() => stepPly(1)}>Next →</button>
                  </div>
                </div>
                <div className="lab-info">
                  <div className="move-hero">
                    <span className="move-hero-san">{move ? `${move.ply}. ${move.san}` : '—'}</span>
                    {move && <span className={`cls-badge ${CLASS_COLORS[move.classification] || ''}`}>{move.classification}</span>}
                  </div>
                  {move && (
                    <>
                      <div className="stat-chips">
                        <span className="stat-chip">Eval {(move.eval_cp / 100).toFixed(2)}</span>
                        <span className="stat-chip">○ {move.side}</span>
                        <span className="stat-chip">White {move.win_white}%</span>
                        {move.draw != null && <span className="stat-chip">Draw {Math.round(move.draw)}%</span>}
                        <span className="stat-chip">{move.game_phase || ''}</span>
                      </div>
                      <div className="accuracy-duo">
                        <span>W accuracy <strong>{game.accuracy_white ?? '—'}</strong></span>
                        <span>B accuracy <strong>{game.accuracy_black ?? '—'}</strong></span>
                      </div>
                      {move.move_summary && <p className="review-report-text">{move.move_summary}</p>}
                      <ProsCons
                        advantages={move.advantages}
                        disadvantages={move.disadvantages}
                        title={`${move.side === 'white' ? 'White' : 'Black'} move ${move.san}`}
                      />
                      {move.parameters && (
                        <div className="learn-params">
                          {Object.values(move.parameters).map((p) => <ParamRow key={p.name} p={p} />)}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </motion.section>

      <motion.section id="learn-position" className="glass-panel learn-section" variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}>
        <div className="learn-section-head">
          <span className="learn-kicker">Chapter IV · Laboratory</span>
          <h2>♟️ Judge any position</h2>
          <p>Paste any FEN — a random arrangement of pieces. You get the full verdict for <strong>both White and Black</strong>, plus the best plans for whichever side is to move.</p>
        </div>
        <div className="fen-row">
          <input className="fen-input interactive" value={fenInput} onChange={(e) => setFenInput(e.target.value)} spellCheck={false} placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" />
          <button className="btn-neon interactive" onClick={analyzeFen} disabled={posBusy}>
            {posBusy ? 'Reading…' : '🔍 Analyze'}
          </button>
        </div>
        {posError && <div className="alert alert-error">{posError}</div>}
        {posData && (
          <motion.div className="lab-split" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="lab-board">
              <Board2D id="positionLabBoard" fen={posData.fen} disabled playerColor="white" />
              <div className="eval-hero">
                <span className="eval-hero-num">{(posData.evaluation.net_score_centipawns / 100).toFixed(2)}</span>
                <span className="eval-hero-sub">{posData.evaluation.game_phase} · {posData.turn} to move · {posData.legal_move_count} legal</span>
              </div>
              {probs && (
                <div className="mini-wdl">
                  <div className="mini-wdl-bar">
                    <div className="mini-w" style={{ width: `${probs.white}%` }} />
                    <div className="mini-d" style={{ width: `${probs.draw}%` }} />
                    <div className="mini-b" style={{ width: `${probs.black}%` }} />
                  </div>
                  <div className="mini-wdl-legend">
                    <span>⚪ {Math.round(probs.white)}%</span>
                    <span>½ {Math.round(probs.draw)}%</span>
                    <span>⚫ {Math.round(probs.black)}%</span>
                  </div>
                </div>
              )}
            </div>
            <div className="lab-info">
              <h4 className="lab-h">Position verdict</h4>
              <p className="review-report-text">{posData.evaluation.verdict}</p>
              {(posData.evaluation.strategic_insights || []).map((s, i) => (
                <p key={i} className="review-report-text">• {s}</p>
              ))}
              <h4 className="lab-h">Best plans — {posData.turn} to move</h4>
              {(posData.candidates_side_to_move || []).map((c, i) => (
                <div key={c.move_uci} className="cand-row">
                  <span className="cand-rank">#{i + 1}</span>
                  <strong>{c.move_san}</strong>
                  <span className="cand-note">{c.explanation || ''}</span>
                </div>
              ))}
              <h4 className="lab-h">…and for the other side</h4>
              {(posData.candidates_flipped_side.candidates || []).map((c, i) => (
                <div key={c.move_uci} className="cand-row">
                  <span className="cand-rank">#{i + 1}</span>
                  <strong>{c.move_san}</strong>
                  <span className="cand-note">{c.explanation || ''}</span>
                </div>
              ))}
              <h4 className="lab-h">Full parameters</h4>
              <div className="learn-params">
                {Object.values(posData.evaluation.parameters || {}).map((p) => <ParamRow key={p.name} p={p} />)}
              </div>
            </div>
          </motion.div>
        )}
      </motion.section>

      <motion.section id="learn-gm" className="glass-panel learn-section" variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}>
        <div className="learn-section-head">
          <span className="learn-kicker">Chapter V · The Arena</span>
          <h2>🏛️ Think Like a GM</h2>
          <p>Real grandmaster middlegames, straight from the training vault. Make your move — the forged brain judges it instantly.</p>
        </div>
        <GmChallenge />
      </motion.section>
    </motion.div>
  );
}
