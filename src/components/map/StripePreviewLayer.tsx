'use client';

import {useMap, useMapContext} from '@/contexts/MapContext';
import {useMapDisplayStore} from '@/stores/mapDisplayStore';
import {useMowAngleCalibrationStore} from '@/stores/mowAngleCalibrationStore';
import {useSelectedMower} from '@/stores/mowersStore';
import {generateMowStripes} from '@/utils/area-utils';
import {datumToRelative} from '@/utils/coordinates';
import {DEFAULT_STRIPE_ANGLE_OFFSET_DEG} from '@/utils/mow-angle-calibration';
import {featureCollection} from '@turf/helpers';
import type {Feature, FeatureCollection, LineString, Polygon} from 'geojson';
import type {LineLayerSpecification} from 'maplibre-gl';
import {RLayer, RSource} from 'maplibre-react-components';
import {useEffect, useMemo} from 'react';

// Dark halo underneath + a bright solid line on top, so it reads clearly over both satellite and
// plain map backgrounds - a thin grey dashed line turned out to be nearly invisible/dot-like.
// Magenta/pink is close to the complementary color of the green mowing-area fill, so it stands
// out against the one background it's actually drawn over most of the time.
const lineHaloPaint: LineLayerSpecification['paint'] = {
  'line-color': '#000000',
  'line-width': 5.5,
  'line-opacity': 0.7,
};
const linePaint: LineLayerSpecification['paint'] = {
  'line-color': '#ff1fa3',
  'line-width': 3,
};

const emptyCollection: FeatureCollection<LineString> = featureCollection([]);

// Live "what would this angle look like" preview while editing an area's mow angle - see
// generateMowStripes for the actual geometry and its limitations.
export default function StripePreviewLayer() {
  const map = useMap();
  const {features, datumOrFallback} = useMapContext();
  const stripePreview = useMapDisplayStore((s) => s.stripePreview);
  const mowerId = useSelectedMower((m) => m?.id);
  const offsetDeg = useMowAngleCalibrationStore(
    (s) => (mowerId ? s.calibrations[mowerId]?.offsetDeg : undefined) ?? DEFAULT_STRIPE_ANGLE_OFFSET_DEG,
  );
  const fetchCalibration = useMowAngleCalibrationStore((s) => s.fetchCalibration);

  useEffect(() => {
    if (mowerId) void fetchCalibration(mowerId);
  }, [mowerId, fetchCalibration]);

  const stripes = useMemo(() => {
    if (!stripePreview) return emptyCollection;
    const area = features.features.find((f) => f.id === stripePreview.areaId) as Feature<Polygon> | undefined;
    if (!area || area.geometry.type !== 'Polygon') return emptyCollection;

    const datum = datumToRelative([datumOrFallback.long, datumOrFallback.lat]);
    const lines = generateMowStripes(area, stripePreview.angleDeg, stripePreview.spacingMeters, datum, offsetDeg);
    return featureCollection(lines);
  }, [features, stripePreview, datumOrFallback, offsetDeg]);

  // mapbox-gl-draw (edit mode) keeps re-adding its own layers, which pushes them back above
  // anything added earlier - so without this, the preview ends up hidden under the area's edit-mode
  // fill as soon as the outline is touched. Re-raising ours after every stripe update keeps it on
  // top regardless of what draw does in between.
  useEffect(() => {
    if (!map) return;
    try {
      map.moveLayer('stripe-preview-halo-layer');
      map.moveLayer('stripe-preview-layer');
    } catch {
      // layers not added to the map yet
    }
  }, [map, stripes]);

  return (
    <>
      <RSource id="stripe-preview-source" type="geojson" data={stripes} />
      <RLayer id="stripe-preview-halo-layer" source="stripe-preview-source" type="line" paint={lineHaloPaint} />
      <RLayer id="stripe-preview-layer" source="stripe-preview-source" type="line" paint={linePaint} />
    </>
  );
}
