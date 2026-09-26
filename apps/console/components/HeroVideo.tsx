'use client';

import { useEffect, useRef } from 'react';

/**
 * The landing hero's backdrop: the project's own /media/hero-background.mp4 (referenced, never
 * copied), muted, looping, inline, under a dark blue overlay so the headline keeps its contrast.
 * It only plays when the viewer has not asked for reduced motion; otherwise it never starts and
 * `.hero-video` is hidden (globals.css), leaving the static gradient.
 */
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      if (mq.matches) video.pause();
      else void video.play().catch(() => undefined);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <video
        ref={ref}
        className="hero-video absolute inset-0 h-full w-full object-cover opacity-40"
        src="/media/hero-background.mp4"
        muted
        loop
        playsInline
        preload="metadata"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-white/85 via-ocean-900/85 to-white" />
    </div>
  );
}
