import {AreaProps} from '@/stores/schemas';
import {DEFAULT_STRIPE_ANGLE_OFFSET_DEG} from '@/utils/mow-angle-calibration';
import {area as turfArea} from '@turf/area';
import bbox from '@turf/bbox';
import {booleanPointInPolygon} from '@turf/boolean-point-in-polygon';
import {featureCollection, lineString, multiPolygon, point, polygon} from '@turf/helpers';
import {nearestPointOnLine} from '@turf/nearest-point-on-line';
import {pointOnFeature} from '@turf/point-on-feature';
import {polygonToLine} from '@turf/polygon-to-line';
import {polygonize} from '@turf/polygonize';
import {Feature, GeoJsonProperties, Polygon, type LineString, type MultiPolygon, type Position} from 'geojson';
import {customAlphabet} from 'nanoid';
import sweeplineIntersections from 'sweepline-intersections';
import {pointToAbsolute, pointToRelative, type AbsolutePoint, type UtmPoint} from './coordinates';

export const generateId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 32);

export const getBiggestArea = <P extends GeoJsonProperties = AreaProps>(areas: Feature<Polygon, P>[]) => {
  if (areas.length === 0) throw new Error('Cannot get biggest area from empty array');
  return areas.reduce(
    (max, curr) => {
      const currArea = turfArea(curr);
      return currArea > max.area ? {feature: curr, area: currArea} : max;
    },
    {feature: areas[0], area: turfArea(areas[0])},
  ).feature;
};

export const removeMiniCoords = (feature: Feature<Polygon | MultiPolygon> | null) => {
  if (feature === null) return null;
  const coords = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const filteredCoords = coords.filter((coord) => turfArea(polygon(coord)) >= 0.001);
  if (filteredCoords.length === 0) {
    return undefined;
  } else if (filteredCoords.length === 1) {
    return polygon(filteredCoords[0]);
  } else {
    return multiPolygon(filteredCoords);
  }
};

const insertPointsOnLine = (line: Feature<LineString>, points: Position[]) => {
  let newLine = line;
  for (const point of points) {
    const snapped = nearestPointOnLine(newLine, point);
    newLine = lineString(newLine.geometry.coordinates.toSpliced(snapped.properties.index + 1, 0, point));
  }
  return newLine;
};

export const splitPolygonWithLine = (
  polygon: Feature<Polygon>,
  cutterLine: Feature<LineString>,
): Feature<Polygon>[] => {
  if (polygon.geometry.coordinates.length !== 1) {
    throw new Error('Splitting is only implemented for polygons without holes');
  }

  const polygonLine = polygonToLine(polygon) as Feature<LineString>;

  const intersections: Position[] = sweeplineIntersections(featureCollection([polygonLine, cutterLine]), true);
  const lines = featureCollection([
    insertPointsOnLine(polygonLine, intersections),
    insertPointsOnLine(cutterLine, intersections),
  ]);

  const candidatePolys = polygonize(lines);
  const insidePolys = candidatePolys.features.filter((candidate) =>
    booleanPointInPolygon(pointOnFeature(candidate), polygon),
  );
  return insidePolys.length >= 2 ? insidePolys : [polygon];
};

// Preview-only approximation of the mow stripes for a given angle: parallel lines clipped to the
// area's outline. Same even-odd clipping approach as splitPolygonWithLine (find every intersection
// with the boundary, keep the segments whose midpoint is inside). Obstacles/holes aren't considered
// yet — same limitation splitPolygonWithLine already has, this isn't meant to match Slic3r exactly,
// just to help pick a reasonable angle. Math happens in local meters (via the UTM datum, like the
// rest of the app's position handling) so angle and spacing are metrically correct regardless of
// latitude, not naively in lng/lat degrees.
//
// offsetDeg defaults to the code-verified relationship (see mow-angle-calibration.ts) but should be
// the mower's own calibrated value when one exists - real stripe direction is (angle + offsetDeg).
export function generateMowStripes(
  area: Feature<Polygon>,
  angleDeg: number,
  spacingMeters: number,
  datum: UtmPoint,
  offsetDeg: number = DEFAULT_STRIPE_ANGLE_OFFSET_DEG,
): Feature<LineString>[] {
  if (area.geometry.coordinates.length !== 1) return [];

  const relRing: Position[] = area.geometry.coordinates[0].map((c) => {
    const p = pointToRelative(c as AbsolutePoint, datum);
    return [p.x, p.y];
  });
  const relArea = polygon([relRing]);

  const [minX, minY, maxX, maxY] = bbox(relArea);
  const renderAngleDeg = angleDeg + offsetDeg;
  const angleRad = (renderAngleDeg * Math.PI) / 180;
  const dir: Position = [Math.cos(angleRad), Math.sin(angleRad)];
  const normal: Position = [-dir[1], dir[0]];
  const diag = Math.hypot(maxX - minX, maxY - minY) || 1;
  const center: Position = [(minX + maxX) / 2, (minY + maxY) / 2];
  // This is a direction preview, not a real coverage simulation - capping how many stripes can ever
  // be drawn keeps it legible even on a large area with a narrow real tool width (which would
  // otherwise produce hundreds of lines that just look like a dense hatch/dots when zoomed out).
  const MAX_PREVIEW_LINES = 14;
  const spacing = Math.max(spacingMeters, 0.1, diag / MAX_PREVIEW_LINES);
  const lineCount = Math.ceil(diag / spacing) + 1;

  const boundary = polygonToLine(relArea) as Feature<LineString>;
  const relSegments: [Position, Position][] = [];

  for (let i = -lineCount; i <= lineCount; i++) {
    const offset = i * spacing;
    const base: Position = [center[0] + normal[0] * offset, center[1] + normal[1] * offset];
    const p1: Position = [base[0] - dir[0] * diag, base[1] - dir[1] * diag];
    const p2: Position = [base[0] + dir[0] * diag, base[1] + dir[1] * diag];
    const candidate = lineString([p1, p2]);

    const intersections: Position[] = sweeplineIntersections(featureCollection([boundary, candidate]), true);
    if (intersections.length < 2) continue;

    const sorted = intersections
      .map((pt) => ({pt, t: (pt[0] - p1[0]) * dir[0] + (pt[1] - p1[1]) * dir[1]}))
      .sort((a, b) => a.t - b.t);

    for (let k = 0; k < sorted.length - 1; k++) {
      const a = sorted[k].pt;
      const b = sorted[k + 1].pt;
      const mid: Position = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (booleanPointInPolygon(point(mid), relArea)) {
        relSegments.push([a, b]);
      }
    }
  }

  return relSegments.map(([a, b]) =>
    lineString([
      pointToAbsolute({x: a[0], y: a[1]}, datum),
      pointToAbsolute({x: b[0], y: b[1]}, datum),
    ]),
  );
}
