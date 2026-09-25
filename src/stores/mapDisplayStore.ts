import {create} from 'zustand';
import {persist} from 'zustand/middleware';

export interface StripePreview {
  areaId: string;
  angleDeg: number;
  spacingMeters: number;
}

interface MapDisplayStore {
  showSatelliteLayer: boolean;
  showTrackLayer: boolean;
  showAreaList: boolean;
  selectedJobId: string | null;
  // live mow-angle preview while editing an area's settings — not persisted, cleared when the
  // dialog closes, so it never lingers into a fresh page load
  stripePreview: StripePreview | null;
  setShowSatelliteLayer: (v: boolean) => void;
  setShowTrackLayer: (v: boolean) => void;
  setShowAreaList: (v: boolean) => void;
  setSelectedJobId: (v: string | null) => void;
  setStripePreview: (v: StripePreview | null) => void;
}

export const useMapDisplayStore = create<MapDisplayStore>()(
  persist(
    (set) => ({
      showSatelliteLayer: false,
      showTrackLayer: true,
      showAreaList: true,
      selectedJobId: null,
      stripePreview: null,
      setShowSatelliteLayer: (v) => set({showSatelliteLayer: v}),
      setShowTrackLayer: (v) => set({showTrackLayer: v}),
      setShowAreaList: (v) => set({showAreaList: v}),
      setSelectedJobId: (v) => set({selectedJobId: v}),
      setStripePreview: (v) => set({stripePreview: v}),
    }),
    {
      name: 'map-display',
      partialize: (state) => ({
        showSatelliteLayer: state.showSatelliteLayer,
        showTrackLayer: state.showTrackLayer,
        showAreaList: state.showAreaList,
        selectedJobId: state.selectedJobId,
      }),
    },
  ),
);
