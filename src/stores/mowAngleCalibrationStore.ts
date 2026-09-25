import {create} from 'zustand';

// One real mow with a known configured angle tells us exactly how this specific mower's stripe
// direction relates to the app's `angle` field - see mow-angle-calibration.ts for why that can
// differ per-mower even though the underlying software formula is universal.
export interface MowAngleCalibration {
  offsetDeg: number;
  angleDegUsed: number;
  measuredBearingDeg: number;
  jobId: string;
  distanceMeters: number;
  calibratedAt: number;
}

interface MowAngleCalibrationStore {
  calibrations: Record<string, MowAngleCalibration>;
  loadedMowerIds: Set<string>;
  loadingMowerIds: Set<string>;
  fetchCalibration: (mowerId: string) => Promise<void>;
  setCalibration: (mowerId: string, calibration: MowAngleCalibration) => Promise<void>;
  clearCalibration: (mowerId: string) => Promise<void>;
}

// Calibration describes a property of the physical mower (its own positioning-frame quirk), not
// of this browser or app instance, so it's persisted server-side (see
// src/server/mowAngleCalibrationStore.ts) - every device viewing the same mower sees the same
// value, unlike browser localStorage.
export const useMowAngleCalibrationStore = create<MowAngleCalibrationStore>()((set, get) => ({
  calibrations: {},
  loadedMowerIds: new Set(),
  loadingMowerIds: new Set(),

  fetchCalibration: async (mowerId) => {
    if (get().loadedMowerIds.has(mowerId) || get().loadingMowerIds.has(mowerId)) return;
    set((state) => ({loadingMowerIds: new Set(state.loadingMowerIds).add(mowerId)}));
    try {
      const res = await fetch(`/api/mow-angle-calibration?mowerId=${encodeURIComponent(mowerId)}`);
      const calibration = res.ok ? await res.json() : null;
      set((state) => {
        const calibrations = {...state.calibrations};
        if (calibration) calibrations[mowerId] = calibration;
        return {
          calibrations,
          loadedMowerIds: new Set(state.loadedMowerIds).add(mowerId),
          loadingMowerIds: new Set([...state.loadingMowerIds].filter((id) => id !== mowerId)),
        };
      });
    } catch {
      set((state) => ({loadingMowerIds: new Set([...state.loadingMowerIds].filter((id) => id !== mowerId))}));
    }
  },

  setCalibration: async (mowerId, calibration) => {
    await fetch('/api/mow-angle-calibration', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({mowerId, calibration}),
    });
    set((state) => ({calibrations: {...state.calibrations, [mowerId]: calibration}}));
  },

  clearCalibration: async (mowerId) => {
    await fetch(`/api/mow-angle-calibration?mowerId=${encodeURIComponent(mowerId)}`, {method: 'DELETE'});
    set((state) => {
      const next = {...state.calibrations};
      delete next[mowerId];
      return {calibrations: next};
    });
  },
}));
