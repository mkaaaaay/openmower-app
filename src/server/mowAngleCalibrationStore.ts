import {promises as fs} from 'fs';
import path from 'path';

export interface MowAngleCalibration {
  offsetDeg: number;
  angleDegUsed: number;
  measuredBearingDeg: number;
  jobId: string;
  distanceMeters: number;
  calibratedAt: number;
}

// overridable so a Docker deployment can point this at a mounted volume, same convention as
// SENSOR_HISTORY_DIR
const DATA_DIR = process.env.MOW_ANGLE_CALIBRATION_DIR ?? path.join(process.cwd(), 'data', 'mow-angle-calibration');

function fileFor(mowerId: string) {
  return path.join(DATA_DIR, `${mowerId}.json`);
}

// One JSON file per mower - the calibration describes a property of that physical mower's own
// positioning/frame quirk (see mow-angle-calibration.ts), not of the app instance or browser, so
// it belongs server-side where every device viewing the same mower sees the same value.
export async function getCalibration(mowerId: string): Promise<MowAngleCalibration | null> {
  try {
    const raw = await fs.readFile(fileFor(mowerId), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setCalibration(mowerId: string, calibration: MowAngleCalibration): Promise<void> {
  const file = fileFor(mowerId);
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, JSON.stringify(calibration));
}

export async function clearCalibration(mowerId: string): Promise<void> {
  try {
    await fs.unlink(fileFor(mowerId));
  } catch {
    // already gone
  }
}
