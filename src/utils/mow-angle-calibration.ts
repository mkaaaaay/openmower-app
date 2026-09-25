import type {TrackSegment} from '@/utils/track-pipeline';

// Minimum distance between consecutive track points to count as a direction sample - filters out
// GPS jitter while standing still or turning slowly, so only genuine straight-line driving
// contributes to the bearing estimate.
const MIN_STEP_METERS = 0.03;

export interface DominantBearing {
  bearingDeg: number;
  totalDistanceMeters: number;
}

// Distance-weighted circular mean of the driven direction, treated mod 180° (a stripe and its
// reverse direction are the same line). Only blades-on segments count, so turns/transport between
// stripes and the outline pass at the start don't skew the result - the actual mowing stripes
// dominate by total distance covered.
export function computeDominantBearing(segments: TrackSegment[]): DominantBearing | null {
  let sinSum = 0;
  let cosSum = 0;
  let totalDistanceMeters = 0;

  for (const segment of segments) {
    if (!segment.attributes.blades) continue;
    const points = segment.points;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const distance = Math.hypot(dx, dy);
      if (distance < MIN_STEP_METERS) continue;

      // Double the angle so opposite directions (0° and 180°) average together instead of
      // cancelling out, then halve the result back - standard trick for a mod-180 circular mean.
      const doubledAngle = 2 * Math.atan2(dy, dx);
      sinSum += distance * Math.sin(doubledAngle);
      cosSum += distance * Math.cos(doubledAngle);
      totalDistanceMeters += distance;
    }
  }

  if (totalDistanceMeters === 0) return null;

  const bearingDeg = (((Math.atan2(sinSum, cosSum) / 2) * 180) / Math.PI + 360) % 180;
  return {bearingDeg, totalDistanceMeters};
}

// How the app's stored `angle` (0° = east, see AreaSettingsDialog) relates to the real-world
// stripe direction: mower_logic passes it straight through to the Slic3r-based coverage planner,
// which adds a fixed +90° (libslic3r Fill::_infill_direction). That's a software fact, true for
// every installation - but a mower's own local pose frame can still be rotated relative to true
// east/north (no compass, GPS-course-only heading, see the known heading-drift issue), which shows
// up as an extra constant offset specific to that one robot. DEFAULT_OFFSET_DEG is the
// generalizable, code-verified part; per-mower calibration (mowAngleCalibrationStore) refines it
// with a real measurement instead of guessing at the robot-specific part.
export const DEFAULT_STRIPE_ANGLE_OFFSET_DEG = 90;
