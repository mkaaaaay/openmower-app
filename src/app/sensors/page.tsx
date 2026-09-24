'use client';

import {HeaderStat, Page, PageContent, PageHeader} from '@/components/page';
import {computeGaugeScale, fallbackGaugeScale, HorizontalGauge, RadialGauge, VerticalGauge} from '@/components/sensors/gauges';
import {outerCardStyles} from '@/lib/cardStyles';
import {useSelectedMower} from '@/stores/mowersStore';
import type {SensorInfo} from '@/stores/schemas';

import {BatteryFull as BatteryIcon, CheckCircle as CheckIcon, GpsFixed as GpsIcon, Sensors as SensorsIcon} from '@mui/icons-material';
import {Box, Card, CardContent, Chip, Typography, useTheme} from '@mui/material';
import {memo, useMemo} from 'react';

const stateColor = (state: string | undefined) => {
  switch (state) {
    case 'MOWING':
    case 'DOCKED':
      return 'success';
    case 'PAUSED':
    case 'DOCKING':
    case 'UNDOCKING':
      return 'warning';
    case 'ERROR':
      return 'error';
    default:
      return 'default';
  }
};

// shown as a chip on their paired sensor's card instead of their own card
const PAIRED_STATE_SENSOR: Record<string, string> = {om_charge_current: 'om_charge_state'};
const ABSORBED_SENSOR_IDS = new Set(Object.values(PAIRED_STATE_SENSOR));

const CATEGORY_ORDER = ['Battery & Charging', 'Temperatures', 'Mow Motor', 'Other'] as const;

function sensorCategory(info: SensorInfo): (typeof CATEGORY_ORDER)[number] {
  const id = info.sensor_id.toLowerCase();
  if (id.includes('battery') || id.includes('charge')) return 'Battery & Charging';
  if (info.value_description === 'TEMPERATURE') return 'Temperatures';
  if (id.includes('motor')) return 'Mow Motor';
  return 'Other';
}

function groupSensors(sensorInfos: SensorInfo[]): {category: string; sensors: SensorInfo[]}[] {
  const groups = new Map<string, SensorInfo[]>();
  for (const info of sensorInfos) {
    const category = sensorCategory(info);
    (groups.get(category) ?? groups.set(category, []).get(category)!).push(info);
  }
  return CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => ({
    category,
    sensors: groups.get(category)!,
  }));
}

function formatUnit(unit: string): string {
  if (unit === 'deg.C') return '°C';
  return unit;
}

function isCritical(info: SensorInfo, raw: string | undefined, currentState: string | undefined): boolean {
  if (raw === undefined || info.value_type !== 'DOUBLE') return false;
  // 0 rpm is normal outside MOWING, don't flag it as a stall
  if (info.value_description === 'REVOLUTIONS' && currentState !== 'MOWING') return false;
  const value = Number(raw);
  if (Number.isNaN(value)) return false;
  // -1 is the firmware's "unset" sentinel for every threshold (see computeGaugeScale) — ignore it
  // here too, otherwise an unresolved sentinel makes every reading look permanently critical
  if (info.has_critical_low && info.lower_critical_value >= 0 && value <= info.lower_critical_value) return true;
  if (info.has_critical_high && info.upper_critical_value >= 0 && value >= info.upper_critical_value) return true;
  return false;
}

const SensorGauge = memo(function SensorGauge({info, raw}: {info: SensorInfo; raw: string | undefined}) {
  if (info.value_type !== 'DOUBLE' || raw === undefined) return null;
  const value = Number(raw);
  if (Number.isNaN(value)) return null;

  if (info.value_description === 'TEMPERATURE') {
    return <HorizontalGauge value={value} scale={computeGaugeScale(info) ?? undefined} min={0} max={100} />;
  }

  if (info.value_description === 'REVOLUTIONS') {
    const scale = computeGaugeScale(info) ?? fallbackGaugeScale(value);
    return <RadialGauge value={value} scale={scale} />;
  }

  if (info.value_description === 'VOLTAGE' || info.value_description === 'CURRENT') {
    const scale = computeGaugeScale(info) ?? fallbackGaugeScale(value);
    return <VerticalGauge value={value} scale={scale} />;
  }

  return null;
});

function chargeStateColor(raw: string): 'success' | 'info' | 'default' {
  const s = raw.toLowerCase();
  if (s.includes('not charging') || s === 'idle') return 'default';
  if (s.includes('done') || s.includes('complete')) return 'success';
  if (s.includes('charg')) return 'info';
  return 'default';
}

// subscribed separately so it doesn't re-render the numeric card above
function PairedStateChip({sensorId}: {sensorId: string}) {
  const raw = useSelectedMower((m) => m?.sensorData[sensorId]);
  if (!raw) return null;
  return <Chip label={raw} size="small" color={chargeStateColor(raw)} sx={{fontWeight: 600}} />;
}

// subscribes to only its own sensor value to avoid re-rendering every card
const SensorCard = memo(function SensorCard({info}: {info: SensorInfo}) {
  const theme = useTheme();
  const raw = useSelectedMower((m) => m?.sensorData[info.sensor_id]);
  const currentState = useSelectedMower((m) => m?.state.current_state);
  const value = info.value_type === 'DOUBLE' ? Number(raw) : undefined;
  const displayValue =
    info.value_type === 'DOUBLE'
      ? value !== undefined && !Number.isNaN(value)
        ? `${value.toFixed(2)} ${formatUnit(info.unit)}`.trim()
        : '–'
      : (raw ?? '–');
  const critical = isCritical(info, raw, currentState);
  const pairedStateId = PAIRED_STATE_SENSOR[info.sensor_id];

  return (
    <Card sx={{...outerCardStyles(theme), minWidth: 160, flex: '1 0 160px'}}>
      <CardContent sx={{display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1}}>
        <Typography variant="caption" color="text.secondary" sx={{textTransform: 'uppercase', letterSpacing: 0.5}}>
          {info.sensor_name}
        </Typography>
        <Box sx={{display: 'flex', alignItems: 'center', gap: 1}}>
          <Typography variant="h6" fontWeight="bold" color={critical ? 'error' : 'text.primary'}>
            {displayValue}
          </Typography>
          {pairedStateId && <PairedStateChip sensorId={pairedStateId} />}
        </Box>
        <SensorGauge info={info} raw={raw} />
      </CardContent>
    </Card>
  );
});

// isolated so this doesn't re-render the whole gauge grid on each tick
function CriticalCountStat({sensorInfos}: {sensorInfos: SensorInfo[]}) {
  const sensorData = useSelectedMower((m) => m?.sensorData) ?? {};
  const currentState = useSelectedMower((m) => m?.state.current_state);
  const criticalCount = sensorInfos.filter((info) => isCritical(info, sensorData[info.sensor_id], currentState)).length;
  return <HeaderStat icon={<CheckIcon />} value={criticalCount} label="Critical" />;
}

function StateHeaderStats() {
  const state = useSelectedMower((m) => m?.state);
  return (
    <>
      <HeaderStat icon={<BatteryIcon />} value={`${state?.battery_percentage ?? '–'}%`} label="Battery" />
      <HeaderStat icon={<GpsIcon />} value={`${state?.gps_percentage ?? '–'}%`} label="GPS" />
    </>
  );
}

function StateChips() {
  const state = useSelectedMower((m) => m?.state);
  return (
    <Box sx={{display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 3}}>
      <Chip label={state?.current_state ?? 'UNKNOWN'} color={stateColor(state?.current_state)} icon={<CheckIcon />} />
      <Chip label={state?.is_charging ? 'Charging' : 'Not charging'} size="small" />
      <Chip label={state?.emergency ? 'Emergency active' : 'No emergency'} color={state?.emergency ? 'error' : 'default'} size="small" />
    </Box>
  );
}

export default function SensorsPage() {
  const sensorInfos = useSelectedMower((m) => m?.sensorInfos) ?? [];
  const groups = useMemo(() => groupSensors(sensorInfos), [sensorInfos]);

  return (
    <Page>
      <PageHeader title="Sensor Data & Diagnostics" subtitle="Live values straight from the mower, over MQTT">
        <StateHeaderStats />
        <HeaderStat icon={<SensorsIcon />} value={sensorInfos.length} label="Sensors" />
        <CriticalCountStat sensorInfos={sensorInfos} />
      </PageHeader>

      <PageContent>
        <StateChips />

        {sensorInfos.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No sensor data yet — waiting for `sensor_infos/json`…
          </Typography>
        ) : (
          <Box sx={{display: 'flex', flexDirection: 'column', gap: 3}}>
            {groups.map(({category, sensors}) => (
              <Box key={category}>
                <Typography variant="subtitle2" color="text.secondary" sx={{mb: 1, textTransform: 'uppercase', letterSpacing: 0.5}}>
                  {category}
                </Typography>
                <Box sx={{display: 'flex', flexWrap: 'wrap', gap: 2}}>
                  {sensors
                    .filter((info) => !ABSORBED_SENSOR_IDS.has(info.sensor_id))
                    .map((info) => (
                      <SensorCard key={info.sensor_id} info={info} />
                    ))}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </PageContent>
    </Page>
  );
}
