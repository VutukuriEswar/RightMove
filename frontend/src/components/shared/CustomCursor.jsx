import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useThemeStore } from '../../store/themeStore';

const LIGHT_FILL   = '#8B2500';
const LIGHT_OUTLINE = '#FFF8EE';
const DARK_FILL    = '#D4AF37';
const DARK_OUTLINE = '#FFF8EE';

const LIGHT_GLOW = 'rgba(139, 37, 0, 0.65)';
const DARK_GLOW  = 'rgba(212, 175, 55, 0.7)';

const supportsHover = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;

export default function CustomCursor() {
  const theme = useThemeStore((s) => s.theme);
  const ref = useRef(null);
  const pos = useRef({ x: -100, y: -100 });
  const raf = useRef(null);
  const visibleRef = useRef(false);
  const prevTheme = useRef(theme);
  const [enabled] = useState(supportsHover);
  const [glowing, setGlowing] = useState(false);
  const [visible, setVisible] = useState(false);

  const isDark = theme === 'dark';
  const fillColor = isDark ? DARK_FILL : LIGHT_FILL;
  const outlineColor = isDark ? DARK_OUTLINE : LIGHT_OUTLINE;
  const glowColor = isDark ? DARK_GLOW : LIGHT_GLOW;

  const show = useCallback(() => {
    if (!visibleRef.current) {
      visibleRef.current = true;
      setVisible(true);
    }
  }, []);

  const hide = useCallback(() => {
    if (visibleRef.current) {
      visibleRef.current = false;
      setVisible(false);
    }
  }, []);

  const onMouseMove = useCallback((e) => {
    pos.current.x = e.clientX;
    pos.current.y = e.clientY;
    show();
  }, [show]);

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseleave', hide);
    document.addEventListener('mouseenter', show);

    const tick = () => {
      if (ref.current) {
        ref.current.style.transform =
          `translate3d(${pos.current.x}px, ${pos.current.y}px, 0)`;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', hide);
      document.removeEventListener('mouseenter', show);
      cancelAnimationFrame(raf.current);
    };
  }, [enabled, onMouseMove, show, hide]);

  useEffect(() => {
    if (prevTheme.current !== theme) {
      prevTheme.current = theme;
      setGlowing(true);
      const t = setTimeout(() => setGlowing(false), 850);
      return () => clearTimeout(t);
    }
  }, [theme]);

  if (!enabled) return null;

  return (
    <div
      ref={ref}
      className={`custom-cursor${visible ? ' visible' : ''}${glowing ? ' glowing' : ''}`}
      style={{ '--cursor-glow-color': glowColor }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 20 28"
        width="15"
        height="21"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M2.5 2.5 L2.5 20 L7 16 L10 25 L13 23.5 L9.5 15 L16 15 Z"
          fill="rgba(0,0,0,0.18)"
          transform="translate(0.8, 1.6)"
        />

        <path
          className="cursor-outline"
          d="M1 0 L1 21 L5.5 16 L9.5 26.5 L13.5 25 L9.5 15 L17 15 Z"
          style={{ fill: outlineColor }}
          stroke="rgba(0,0,0,0.12)"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        <path
          className="cursor-fill"
          d="M2.2 1.2 L2.2 19.5 L6 15.5 L9 24.5 L12 23.2 L8.5 14.5 L15 14.5 Z"
          style={{ fill: fillColor }}
        />

        <path
          d="M2.2 1.2 L2.2 7 L4 5.5 Z"
          fill="rgba(255,255,255,0.35)"
        />
      </svg>
    </div>
  );
}