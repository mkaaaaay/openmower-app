import {type Position} from '@/stores/schemas';
import {useEffect, useRef, useState} from 'react';

/**
 * Derives a live speed estimate (m/s) from consecutive position/json updates —
 * there is no speed field on the wire, so this measures actual distance
 * travelled between updates over the real (client-side) time elapsed.
 *
 * The raw instantaneous value (distance/dt between two updates) is very
 * noisy — a couple of cm of GPS jitter over a short interval reads as a
 * large speed swing — so it's smoothed with exponential decay (same
 * half-life approach as useSmoothedPosition) before being returned.
 */
export function useComputedSpeed(position: Position | null | undefined, halfLifeMs = 400): number {
  const [speed, setSpeed] = useState(0);
  const lastRef = useRef<{x: number; y: number; t: number} | null>(null);
  const smoothedRef = useRef(0);

  useEffect(() => {
    if (!position) return;
    const now = performance.now();
    const last = lastRef.current;

    if (last) {
      const dt = (now - last.t) / 1000;
      // Ignore near-duplicate updates (dt too small makes the estimate noisy).
      if (dt > 0.05) {
        const dist = Math.hypot(position.x - last.x, position.y - last.y);
        const instantSpeed = dist / dt;
        const alpha = 1 - Math.pow(0.5, dt / (halfLifeMs / 1000));
        smoothedRef.current += (instantSpeed - smoothedRef.current) * alpha;
        setSpeed(smoothedRef.current);
        lastRef.current = {x: position.x, y: position.y, t: now};
      }
    } else {
      lastRef.current = {x: position.x, y: position.y, t: now};
    }
  }, [position, halfLifeMs]);

  return speed;
}
