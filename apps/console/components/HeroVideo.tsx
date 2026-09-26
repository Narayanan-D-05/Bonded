'use client';

import { useEffect, useRef } from 'react';

/**
 * The landing hero's backdrop: the project's own /media/hero-background.mp4 (referenced, never
 * copied), muted, looping, inline, inverted to a light tone (.glyph-art-light) so its motion shows on the white theme, with a light white fade on the left only, so the headline keeps its contrast.
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
        className="hero-video glyph-art-light absolute inset-0 h-full w-full object-cover opacity-70"
        src="/media/hero-background.mp4"
        muted
        loop
        playsInline
        preload="metadata"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-white/70 via-white/20 to-transparent" />
    </div>
  );
}
