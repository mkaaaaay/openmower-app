'use client';

import {useMapContext} from '@/contexts/MapContext';
import {useSelectedMower} from '@/stores/mowersStore';
import type {Datum} from '@/stores/schemas';
import {datumToRelative, pointsToAbsolute} from '@/utils/coordinates';
import {featureCollection} from '@turf/helpers';
import type {Feature, FeatureCollection, LineString} from 'geojson';
import type {ExpressionSpecification, LineLayerSpecification} from 'maplibre-gl';
import {RLayer, RSource} from 'maplibre-react-components';
import {useMemo} from 'react';

const emptyCollection: FeatureCollection<LineString> = featureCollection([]);

const linePaint: LineLayerSpecification['paint'] = {
  'line-color': ['get', 'color'] as unknown as ExpressionSpecification,
  'line-width': ['get', 'line_width'] as unknown as ExpressionSpecification,
};

/** Live in-progress area-recording polygon (map_overlay/json), drawn while driving around. */
export default function MapOverlayLayer({datum}: {datum: Datum}) {
  const mapOverlay = useSelectedMower((s) => s?.mapOverlay);
  const {datumOrFallback} = useMapContext();
  const utmDatum = useMemo(() => datumToRelative([datumOrFallback.long, datumOrFallback.lat]), [datumOrFallback]);

  const data = useMemo<FeatureCollection<LineString>>(() => {
    if (!mapOverlay || mapOverlay.polygons.length === 0) return emptyCollection;
    const features: Feature<LineString>[] = mapOverlay.polygons
      .filter((poly) => poly.poly.length >= 2)
      .map((poly) => {
        const coords = pointsToAbsolute(poly.poly, utmDatum);
        if (poly.is_closed) coords.push(coords[0]);
        return {
          type: 'Feature',
          geometry: {type: 'LineString', coordinates: coords},
          properties: {color: poly.color, line_width: Math.max(2, poly.line_width * 4)},
        };
      });
    return featureCollection(features);
  }, [mapOverlay, utmDatum]);

  if (!datum) return null;

  return (
    <>
      <RSource id="area-recording-overlay-source" type="geojson" data={data} />
      <RLayer
        id="area-recording-overlay-layer"
        source="area-recording-overlay-source"
        type="line"
        layout={{'line-join': 'round', 'line-cap': 'round'}}
        paint={linePaint}
      />
    </>
  );
}
