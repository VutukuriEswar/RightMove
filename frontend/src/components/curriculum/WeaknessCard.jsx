import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import MasteryGauge from './MasteryGauge';
import AgentReport from './AgentReport';
import { useCurriculumStore } from '../../store/curriculumStore';

export default function WeaknessCard({ cluster }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const activeReports = useCurriculumStore((s) => s.activeReports);
  const fetchReportForCluster = useCurriculumStore((s) => s.fetchReportForCluster);
  const acknowledgeReport = useCurriculumStore((s) => s.acknowledgeReport);

  const clusterId = cluster.cluster_id;
  const report = activeReports[clusterId] || cluster.latest_report || null;

  const handleToggleReport = async () => {
    if (!expanded && !report) {
      await fetchReportForCluster(clusterId);
    }
    setExpanded((v) => !v);
  };

  const handleDrillNow = () => {
    navigate(`/learn/drill?cluster=${encodeURIComponent(clusterId)}`);
  };

  const handleDismissReport = async () => {
    if (report && report._id) {
      await acknowledgeReport(report._id, clusterId);
    }
    setExpanded(false);
  };

  const formatLastSeen = (dateVal) => {
    if (!dateVal) return 'Recently';
    const date = new Date(dateVal);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays} days ago`;
  };

  const getStageBadgeStyle = (stage) => {
    switch (stage) {
      case 'Resolved':
        return { background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' };
      case 'Strong':
        return { background: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4', border: '1px solid rgba(6, 182, 212, 0.3)' };
      case 'Improving':
        return { background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)' };
      default:
        return { background: 'rgba(244, 63, 94, 0.15)', color: '#f43f5e', border: '1px solid rgba(244, 63, 94, 0.3)' };
    }
  };

  const stageStyle = getStageBadgeStyle(cluster.stage);

  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.75)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 16,
        padding: '20px',
        marginBottom: '16px',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 240px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <h3
              style={{
                fontSize: '1.2rem',
                fontWeight: 700,
                color: '#fff',
                margin: 0,
              }}
            >
              {cluster.display_name}
            </h3>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 999,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                ...stageStyle,
              }}
            >
              {cluster.stage || 'Active'}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: '0.85rem',
              color: '#94a3b8',
              flexWrap: 'wrap',
            }}
          >
            <span>{cluster.mistake_count} mistakes</span>
            <span>•</span>
            <span>Last seen {formatLastSeen(cluster.last_seen)}</span>
            {cluster.pending_drills_count > 0 && (
              <>
                <span>•</span>
                <span
                  style={{
                    color: '#38bdf8',
                    fontWeight: 600,
                  }}
                >
                  ⚡ {cluster.pending_drills_count} due for review
                </span>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <MasteryGauge health={cluster.health} size={64} />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 16,
          paddingTop: 14,
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={handleToggleReport}
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: expanded ? '#38bdf8' : '#cbd5e1',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>{expanded ? 'Hide Report ↑' : 'View Report ↓'}</span>
        </button>

        <button
          type="button"
          className="btn-neon interactive"
          onClick={handleDrillNow}
          style={{
            padding: '8px 18px',
            fontSize: '0.85rem',
          }}
        >
          Drill Now →
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <AgentReport
            report={report}
            cluster={cluster}
            onDismiss={handleDismissReport}
            onDrillNow={handleDrillNow}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
