import React from 'react';
import { motion } from 'framer-motion';

export default function FriendCard({ friend, isOnline }) {
  return (
    <motion.div
      className="friend-card card"
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
    >
      <div className="friend-avatar">
        {friend.username[0].toUpperCase()}
        <span className={`friend-status-dot ${isOnline ? 'online' : 'offline'}`} />
      </div>

      <div className="friend-info">
        <span className="friend-name">{friend.username}</span>
      </div>
    </motion.div>
  );
}
