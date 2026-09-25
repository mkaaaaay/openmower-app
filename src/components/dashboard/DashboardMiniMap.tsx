'use client';

import ControlButton from '@/components/map/ControlButton';
import DockingStationMarker from '@/components/map/DockingStationMarker';
import {mapStyles} from '@/components/map/mapStyles';
import MowerMarker from '@/components/map/MowerMarker';
import TrackLayer from '@/components/map/TrackLayer';
import {MapContextProvider, useFitToBounds, useMap, useMapContext} from '@/contexts/MapContext';
import {useMapDisplayStore} from '@/stores/mapDisplayStore';
import {useSelectedMower} from '@/stores/mowersStore';
import {mapToFeatures} from '@/utils/area-converter';
import {datumToRelative, pointToAbsolute} from '@/utils/coordinates';
import {featureCollection} from '@turf/helpers';
import type {Feature, Polygon} from 'geojson';
import {LocateFixedIcon, SatelliteIcon} from 'lucide-react';
import type {ExpressionSpecification, FillLayerSpecification, LineLayerSpecification} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {RFullscreenControl, RLayer, RMap, RMapContextProvider, RSource} from 'maplibre-react-components';
import {Box, type SxProps} from '@mui/material';
import {useEffect, useMemo, useRef, useState} from 'react';

// Close enough to see the mower and its immediate surroundings while following.
const FOLLOW_ZOOM = 21;

// Read-only: no MapboxDraw / edit controls at all, areas are rendered as a
// plain static GeoJSON layer instead of going through the draw framework.
const areaTypeColor: ExpressionSpecification = [
  'case',
  ['==', ['get', 'type'], 'mow'],
  '#4caf50',
  ['==', ['get', 'type'], 'nav'],
  '#dddddd',
  ['==', ['get', 'type'], 'obstacle'],
  '#000000',
  '#fbb03b',
];

const fillPaint: FillLayerSpecification['paint'] = {'fill-color': areaTypeColor, 'fill-opacity': 0.35};
const linePaint: LineLayerSpecification['paint'] = {'line-color': areaTypeColor, 'line-width': 1.5};

function DashboardMiniMapInner({sx}: {sx?: SxProps}) {
  const mapData = useSelectedMower((s) => s?.map);
  const mowerPosition = useSelectedMower((s) => s?.position ?? s?.state.pose);
  const isDocked = useSelectedMower((s) => s?.state.is_charging ?? false);
  const {id, datumOrFallback, setDatum, setFeatures, bounds} = useMapContext();
  const fitToBounds = useFitToBounds();
  const map = useMap();
  const {showSatelliteLayer, setShowSatelliteLayer} = useMapDisplayStore();
  const [followMower, setFollowMower] = useState(true);
  const wasFollowing = useRef(false);

  useEffect(() => {
    setDatum(mapData?.datum ?? null);
  }, [mapData?.datum, setDatum]);

  // Bounds (used for fit-to-bounds) are derived from the context's own
  // `features` state — populate it, same as the real /map page does in
  // display mode, or bounds stay stuck at a zero-area box and the camera
  // never gets a real target to fit to.
  useEffect(() => {
    if (mapData) setFeatures(mapToFeatures(mapData), false);
  }, [mapData, setFeatures]);

  // fitToBounds is a useEffectEvent — it intentionally has no stable
  // identity across renders, so it must stay out of the deps array (same
  // pattern as MowerMap.tsx's onBoundsChanged). Otherwise this effect would
  // re-fire on every live position update and reset any manual zoom/pan.
  // Skipped entirely while following the mower - that has its own camera logic below.
  useEffect(() => {
    if (!followMower) fitToBounds(true, {top: 20, bottom: 20, left: 20, right: 20});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, followMower]);

  // Follow mode: snap to a close zoom the moment it's enabled, then just re-center (keeping
  // whatever zoom the user's since set) on every live position update.
  useEffect(() => {
    if (!followMower || !map || !mowerPosition) {
      wasFollowing.current = false;
      return;
    }
    const utmDatum = datumToRelative([datumOrFallback.long, datumOrFallback.lat]);
    const center = pointToAbsolute(mowerPosition, utmDatum);
    if (!wasFollowing.current) {
      map.jumpTo({center, zoom: FOLLOW_ZOOM});
    } else {
      map.easeTo({center, duration: 300});
    }
    wasFollowing.current = true;
  }, [followMower, map, mowerPosition, datumOrFallback]);

  const areaFeatures = useMemo(() => {
    if (!mapData) return featureCollection([]);
    const polygons = mapToFeatures(mapData).features.filter(
      (f): f is Feature<Polygon> => f.geometry.type === 'Polygon',
    );
    return featureCollection(polygons);
  }, [mapData]);

  if (!mapData) return null;

  return (
    <Box sx={{...sx, position: 'relative', overflow: 'hidden'}}>
      <RMap
        key={id}
        id={id}
        style={{width: '100%', height: '100%'}}
        mapStyle={mapStyles[showSatelliteLayer ? 'satellite' : 'white']}
        initialAttributionControl={false}
        maxZoom={25}
        initialPitchWithRotate={false}
        dragRotate={false}
        onLoad={(e) => {
          e.target.touchZoomRotate.disableRotation();
          // The bounds-change effect can fire before the map is ready to
          // accept fitBounds (race on first mount), so also fit once here.
          if (!followMower) fitToBounds(true, {top: 20, bottom: 20, left: 20, right: 20});
        }}
      >
        <RSource id="dashboard-areas-source" type="geojson" data={areaFeatures} />
        <RLayer id="dashboard-areas-fill" source="dashboard-areas-source" type="fill" paint={fillPaint} />
        <RLayer id="dashboard-areas-line" source="dashboard-areas-source" type="line" paint={linePaint} />

        {mapData.docking_stations.map((station) => (
          <DockingStationMarker key={station.id} station={station} datum={datumOrFallback} isDocked={isDocked} />
        ))}
        {mowerPosition && !isDocked && <MowerMarker position={mowerPosition} datum={datumOrFallback} />}
        <TrackLayer />

        <RFullscreenControl position="top-right" />
        <ControlButton
          position="top-right"
          icon={SatelliteIcon}
          title="Satellite"
          active={showSatelliteLayer}
          onClick={() => setShowSatelliteLayer(!showSatelliteLayer)}
        />
        <ControlButton
          position="top-right"
          icon={LocateFixedIcon}
          title={followMower ? 'Stop following' : 'Follow mower'}
          active={followMower}
          onClick={() => setFollowMower(!followMower)}
        />
      </RMap>
    </Box>
  );
}

/** Small, read-only live map for the Dashboard: current position + today's track, no editing. */
export default function DashboardMiniMap({sx}: {sx?: SxProps}) {
  return (
    <RMapContextProvider>
      <MapContextProvider id="dashboard-mini-map">
        <DashboardMiniMapInner sx={sx} />
      </MapContextProvider>
    </RMapContextProvider>
  );
}
