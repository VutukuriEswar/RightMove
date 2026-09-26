import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';

const JOURNEY = [
  {
    icon: '⚔️',
    title: 'Play',
    desc: 'Jump into a quick online match, take on a guided coaching game tuned to your strength, share one board with a friend, or study in the Learn hall — every kind of chess lives here.',
  },
  {
    icon: '🎓',
    title: 'Get coached',
    desc: 'After every move you make, see what was strong about it, what it gave away, and what the board demanded instead — explained in plain words, with the best lines shown on the board.',
  },
  {
    icon: '📈',
    title: 'Review & master',
    desc: 'Replay any game move by move with accuracy grades, blunder alerts and written summaries. Then test yourself against real grandmaster middlegames in Think Like a GM.',
  },
];

const WAYS_TO_PLAY = [
  { icon: '🎓', title: 'Guided Games', desc: 'A coach watches every move — live advice, candidate lines and a full report when the game ends.' },
  { icon: '⚔️', title: 'Quick Match', desc: 'Casual online games against real opponents at your chosen pace, from bullet to classical.' },
  { icon: '🎮', title: 'Pass & Play', desc: 'A classic over-the-board mode — no account required, just chess on one device.' },
  { icon: '📚', title: 'Learn Hall', desc: 'From how the pieces move to reading full positions: rules, notation, your own games dissected, and grandmaster thinking drills.' },
];

export default function Home() {
  const { isLoggedIn } = useAuth();

  return (
    <motion.div
      className="home-page page-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(8px)' }}
      transition={{ duration: 0.5 }}
    >

      <section className="hero">
        <motion.div
          className="hero-content"
          initial={{ opacity: 0, y: 50, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, type: 'spring', bounce: 0.35 }}
        >
          <div className="hero-badge">The Master Chamber</div>
          <h1 className="hero-title">Beyond the Board</h1>
          <p className="hero-subtitle">
            Immersive 3D environments. Advanced analysis. The premier chess experience, fit for grandmasters.
            <br/><br/>
            Step into a realm crafted for those who seek to push their strategic limits. Whether you want to review your past battles with pinpoint accuracy, or test your mettle against simulations of real opponents, the Master Chamber provides every tool necessary for your ascent. Prepare yourself for unparalleled competitive depth.
          </p>
          <div className="hero-actions">
            {isLoggedIn ? (
              <Link to="/lobby" className="btn-neon interactive">Enter the Chamber</Link>
            ) : (
              <>
                <Link to="/signup" className="btn-neon interactive">Join the Court</Link>
                <Link to="/login" className="btn-neon interactive btn-neon-secondary interactive">Sign In</Link>
              </>
            )}
          </div>
        </motion.div>

      </section>

      <section className="features">
        <h2 className="features-title">How RightMove Works</h2>
        <div className="ornament-line">✦ ✦ ✦</div>
        <p className="features-sub">
          RightMove is a complete place to play chess and get better at it. Every game you finish becomes a lesson:
          your moves are graded, your mistakes are explained, and your progress is tracked — all in plain language,
          whether this is your first week or your tenth year at the board.
        </p>
        <div className="features-grid">
          {JOURNEY.map((f, i) => (
            <motion.div
              key={f.title}
              className="feature-card glass-panel interactive"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              whileHover={{ scale: 1.04, translateY: -8 }}
            >
              <span className="feature-icon">{f.icon}</span>
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-desc">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="features">
        <h2 className="features-title">Ways to Play</h2>
        <div className="ornament-line">✦ ✦ ✦</div>
        <p className="features-sub">
          Pick the contest that suits your mood. Play a stranger across the world, learn with a coach looking over
          your shoulder, battle a friend on one screen, or sharpen your thinking with grandmaster positions —
          your history, reports and progress follow you everywhere.
        </p>
        <div className="features-grid">
          {WAYS_TO_PLAY.map((f, i) => (
            <motion.div
              key={f.title}
              className="feature-card glass-panel interactive"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              whileHover={{ scale: 1.04, translateY: -8 }}
            >
              <span className="feature-icon">{f.icon}</span>
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-desc">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

    </motion.div>
  );
}
