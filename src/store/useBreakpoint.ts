import { useSyncExternalStore } from 'react';

/** Design breakpoints: mobile <768 · tablet 768–1023 · laptop 1024–1439 · desktop ≥1440. */
export type Breakpoint = 'mobile' | 'tablet' | 'laptop' | 'desktop';

function current(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  if (w < 1440) return 'laptop';
  return 'desktop';
}

function subscribe(cb: () => void) {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, current, () => 'desktop');
}

/** Phones and small touch tablets get the lighter 3D pipeline. */
export function useLowPower(): boolean {
  const bp = useBreakpoint();
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  return bp === 'mobile' || (coarse && bp === 'tablet');
}
