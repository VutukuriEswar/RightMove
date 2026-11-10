import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  eventStatus,
  formatEventDates,
  formatRoundDate,
  tierLabel,
} from '../../lib/broadcastUtils';

export default function EventCard({ event, index = 0 }) {
  if (!event) return null;

  const status = eventStatus(event);
  const round = event.active_round;
  const meta = [event.format, event.time_control, event.location]
    .filter(Boolean)
    .join(' · ');

  return (
    <motion.article
      className="ev-card glass-panel interactive"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.4) }}
      whileHover={{ y: -4 }}
    >
      <Link to={`/events/${event.id}`} className="ev-card-link">
        <div className="ev-card-media">
          <div className="ev-card-media-fallback" aria-hidden="true">♜</div>
          {event.image && (
            <img
              src={event.image}
              alt=""
              loading="lazy"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
          <span className={`ev-status ev-status-${status.key}`}>
            {status.key === 'live' && <span className="ev-live-dot" />}
            {status.label}
          </span>
          {tierLabel(event.tier) && (
            <span className="ev-tier">{tierLabel(event.tier)}</span>
          )}
        </div>
        <div className="ev-card-body">
          <h3 className="ev-card-title">{event.name}</h3>
          {meta && <p className="ev-card-meta">{meta}</p>}
          <div className="ev-card-foot">
            <span className="ev-card-round">
              {round
                ? `${round.name}${round.starts_at ? ` · ${formatRoundDate(round.starts_at)}` : ''}`
                : formatEventDates(event.dates)}
            </span>
            <span className="ev-card-cta">Watch →</span>
          </div>
        </div>
      </Link>
    </motion.article>
  );
}
