'use client';

import {createContext, ReactNode, useContext, useEffect, useState} from 'react';

interface MinMax {
  min: number;
  max: number;
}

const SensorHistoryContext = createContext<Record<string, MinMax>>({});

const POLL_INTERVAL_MS = 60 * 1000;

// Fetches the server-side 24h min/max (see src/server/sensorHistoryStore.ts) once for
// the whole page instead of once per sensor card, and keeps it fresh via polling.
export function SensorHistoryProvider({mowerId, children}: {mowerId: string | undefined; children: ReactNode}) {
  const [data, setData] = useState<Record<string, MinMax>>({});

  useEffect(() => {
    if (!mowerId) return;
    let cancelled = false;
    const fetchOnce = () => {
      fetch(`/api/sensor-history?mowerId=${encodeURIComponent(mowerId)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (!cancelled && json) setData(json);
        })
        .catch(() => {});
    };
    fetchOnce();
    const interval = setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mowerId]);

  return <SensorHistoryContext.Provider value={data}>{children}</SensorHistoryContext.Provider>;
}

export function useSensor24hMinMax(sensorId: string): MinMax | null {
  return useContext(SensorHistoryContext)[sensorId] ?? null;
}
