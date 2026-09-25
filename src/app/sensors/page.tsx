'use client';

import {HeaderStat, Page, PageContent, PageHeader} from '@/components/page';
import {computeGaugeScale, fallbackGaugeScale, HorizontalGauge, RadialGauge, VerticalGauge} from '@/components/sensors/gauges';
import {outerCardStyles} from '@/lib/cardStyles';
import {useSelectedMower} from '@/stores/mowersStore';
import type {SensorInfo} from '@/stores/schemas';

import {
  Battery20,
  Battery30,
  Battery50,
  Battery60,
  Battery80,
  Battery90,
  BatteryAlert,
  BatteryCharging20,
  BatteryCharging30,
  BatteryCharging50,
  BatteryCharging60,
  BatteryCharging80,
  BatteryCharging90,
  BatteryChargingFull,
  BatteryFull as BatteryIcon,
  CheckCircle as CheckIcon,
  GpsFixed as GpsIcon,
  Sensors as SensorsIcon,
} from '@mui/icons-material';
import {Box, Card, CardContent, Chip, Typography, useTheme} from '@mui/material';
import {memo, useMemo} from 'react';
import type {SvgIconComponent} from '@mui/icons-material';

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

// rendered as one consolidated BatterySummaryCard instead of individual sensor cards — see below
const BATTERY_CATEGORY_SENSOR_IDS = new Set(['om_v_battery', 'om_v_charge', 'om_charge_current', 'om_charge_state']);

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

// xbot_positioning.cpp hardcodes exactly 999 as "no GPS fix / EKF has no absolute pose" for
// this one sensor — showing it as "999.00 m" reads like a real (huge) accuracy reading
const NO_GPS_FIX_SENSOR_ID = 'om_gps_accuracy';
const NO_GPS_FIX_VALUE = 999;
// IdleBehavior.cpp and DockingBehavior.cpp both turn GPS off on/near entering these states
// (back on when mowing/undocking starts) to save power while parked/docked — so "no fix"
// there is by design, not a signal problem
const GPS_DISABLED_BY_DESIGN_STATES = new Set(['IDLE', 'DOCKING']);
// blade motor only spins during MOWING — outside that, current/RPM are always 0 by design,
// so a full gauge for an expected-zero reading is just noise
const MOTOR_ACTIVITY_SENSOR_IDS = new Set(['om_mow_motor_current', 'om_mow_motor_rpm']);

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

  // Voltage gauges turned out to add no real value — the useful range is a tiny sliver of
  // whatever domain we'd pick, so it's just a plain number for those now.
  if (info.value_description === 'CURRENT') {
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

// subscribes to only its own sensor value to avoid re-rendering every card
const SensorCard = memo(function SensorCard({info}: {info: SensorInfo}) {
  const theme = useTheme();
  const raw = useSelectedMower((m) => m?.sensorData[info.sensor_id]);
  const currentState = useSelectedMower((m) => m?.state.current_state);
  const isCharging = useSelectedMower((m) => m?.state.is_charging);
  const value = info.value_type === 'DOUBLE' ? Number(raw) : undefined;
  const numericValue = value !== undefined && !Number.isNaN(value) ? value : undefined;
  const noGpsFix = info.sensor_id === NO_GPS_FIX_SENSOR_ID && numericValue !== undefined && numericValue >= NO_GPS_FIX_VALUE;
  const gpsOffByDesign = noGpsFix && currentState !== undefined && GPS_DISABLED_BY_DESIGN_STATES.has(currentState);
  // is_charging is only true while physically in the dock — a safe proxy, since IDLE alone can
  // also mean "paused out on the lawn", where GPS is off too but not because of the dock
  const inDockingStation = gpsOffByDesign && !!isCharging;
  const motorOff = MOTOR_ACTIVITY_SENSOR_IDS.has(info.sensor_id) && currentState !== 'MOWING';
  const displayValue = motorOff
    ? 'Motor off'
    : noGpsFix
      ? gpsOffByDesign
        ? 'GPS off'
        : 'No fix'
      : numericValue !== undefined
        ? `${numericValue.toFixed(2)} ${formatUnit(info.unit)}`.trim()
        : (raw ?? '–');
  const critical = isCritical(info, raw, currentState);

  return (
    <Card sx={{...outerCardStyles(theme), minWidth: 160, flex: '1 0 160px'}}>
      <CardContent sx={{display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1}}>
        <Typography variant="caption" color="text.secondary" sx={{textTransform: 'uppercase', letterSpacing: 0.5}}>
          {info.sensor_name}
        </Typography>
        <Typography variant="h6" fontWeight="bold" color={critical ? 'error' : 'text.primary'}>
          {displayValue}
        </Typography>
        {inDockingStation && (
          <Typography variant="caption" color="text.secondary">
            (Docking Station)
          </Typography>
        )}
        {!motorOff && <SensorGauge info={info} raw={raw} />}
      </CardContent>
    </Card>
  );
});

// nearest-breakpoint battery icon, mirroring the phone status bar convention users already know
function batteryLevelIcon(percentage: number, charging: boolean): SvgIconComponent {
  const bars: [number, SvgIconComponent, SvgIconComponent][] = [
    [20, Battery20, BatteryCharging20],
    [30, Battery30, BatteryCharging30],
    [50, Battery50, BatteryCharging50],
    [60, Battery60, BatteryCharging60],
    [80, Battery80, BatteryCharging80],
    [90, Battery90, BatteryCharging90],
    [100, BatteryIcon, BatteryChargingFull],
  ];
  if (percentage <= 10) return BatteryAlert;
  const [, plain, chargingIcon] = bars.find(([threshold]) => percentage <= threshold) ?? bars[bars.length - 1];
  return charging ? chargingIcon : plain;
}

// Consolidated view of Battery & Charging: percentage + charge status is the actual answer to
// "how's the battery doing", the four raw sensor readings are just supporting detail underneath.
function BatterySummaryCard({sensorInfos}: {sensorInfos: SensorInfo[]}) {
  const theme = useTheme();
  const currentState = useSelectedMower((m) => m?.state.current_state);
  const isCharging = useSelectedMower((m) => m?.state.is_charging);
  const batteryPercentage = useSelectedMower((m) => m?.state.battery_percentage);
  const vBattery = useSelectedMower((m) => m?.sensorData['om_v_battery']);
  const vCharge = useSelectedMower((m) => m?.sensorData['om_v_charge']);
  const chargeCurrent = useSelectedMower((m) => m?.sensorData['om_charge_current']);
  const chargeState = useSelectedMower((m) => m?.sensorData['om_charge_state']);

  const critical = ['om_v_battery', 'om_v_charge', 'om_charge_current'].some((id) => {
    const info = sensorInfos.find((i) => i.sensor_id === id);
    const raw = id === 'om_v_battery' ? vBattery : id === 'om_v_charge' ? vCharge : chargeCurrent;
    return info ? isCritical(info, raw, currentState) : false;
  });

  const details: {label: string; value: string}[] = [
    vBattery !== undefined ? {label: 'Battery', value: `${Number(vBattery).toFixed(2)} V`} : null,
    vCharge !== undefined && isCharging ? {label: 'Charger', value: `${Number(vCharge).toFixed(2)} V`} : null,
    chargeCurrent !== undefined ? {label: 'Current', value: `${Number(chargeCurrent).toFixed(2)} A`} : null,
  ].filter((part): part is {label: string; value: string} => part !== null);

  const BatteryLevelIcon = batteryLevelIcon(batteryPercentage ?? 0, !!isCharging);
  const iconColor = critical ? 'error' : batteryPercentage !== undefined && batteryPercentage <= 20 ? 'warning' : 'success';

  return (
    <Card sx={{...outerCardStyles(theme), minWidth: 220, flex: '1 0 220px'}}>
      <CardContent sx={{display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1}}>
        <Typography variant="caption" color="text.secondary" sx={{textTransform: 'uppercase', letterSpacing: 0.5}}>
          Battery
        </Typography>
        <Box sx={{display: 'flex', alignItems: 'center', gap: 1}}>
          <BatteryLevelIcon color={iconColor} sx={{fontSize: 36}} />
          <Typography variant="h3" fontWeight="bold" color={critical ? 'error' : 'text.primary'}>
            {batteryPercentage ?? '–'}%
          </Typography>
        </Box>
        {chargeState && <Chip label={chargeState} size="small" variant="outlined" color={chargeStateColor(chargeState)} />}
        {details.length > 0 && (
          <Box sx={{display: 'flex', gap: 2, mt: 0.5}}>
            {details.map(({label, value}) => (
              <Box key={label}>
                <Typography variant="caption" color="text.secondary" display="block">
                  {label}
                </Typography>
                <Typography variant="caption">{value}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

// One card instead of two separate "Motor off" cards when not mowing - Current and RPM are both
// trivially 0 then, no need to say so twice.
function MowMotorOffCard() {
  const theme = useTheme();
  return (
    <Card sx={{...outerCardStyles(theme), minWidth: 160, flex: '1 0 160px'}}>
      <CardContent sx={{display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1}}>
        <Typography variant="caption" color="text.secondary" sx={{textTransform: 'uppercase', letterSpacing: 0.5}}>
          Mow Motor
        </Typography>
        <Typography variant="h6" fontWeight="bold" color="text.primary">
          Motor off
        </Typography>
      </CardContent>
    </Card>
  );
}

// left/right ESC temps first (paired side by side), then the rest in whatever order they arrive
const TEMPERATURE_SENSOR_ORDER = ['om_left_esc_temp', 'om_right_esc_temp'];

function CategorySection({category, sensors}: {category: string; sensors: SensorInfo[]}) {
  const currentState = useSelectedMower((m) => m?.state.current_state);
  const motorOff = category === 'Mow Motor' && currentState !== 'MOWING';
  const visible = sensors.filter((info) => !BATTERY_CATEGORY_SENSOR_IDS.has(info.sensor_id));
  const sorted =
    category === 'Temperatures'
      ? [...visible].sort((a, b) => {
          const ai = TEMPERATURE_SENSOR_ORDER.indexOf(a.sensor_id);
          const bi = TEMPERATURE_SENSOR_ORDER.indexOf(b.sensor_id);
          return (ai === -1 ? TEMPERATURE_SENSOR_ORDER.length : ai) - (bi === -1 ? TEMPERATURE_SENSOR_ORDER.length : bi);
        })
      : visible;

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{mb: 1, textTransform: 'uppercase', letterSpacing: 0.5}}>
        {category}
      </Typography>
      <Box sx={{display: 'flex', flexWrap: 'wrap', gap: 2}}>
        {category === 'Battery & Charging' ? (
          <BatterySummaryCard sensorInfos={sensors} />
        ) : motorOff ? (
          <MowMotorOffCard />
        ) : (
          sorted.map((info) => <SensorCard key={info.sensor_id} info={info} />)
        )}
      </Box>
    </Box>
  );
}

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
      <Chip
        label={state?.current_state ?? 'UNKNOWN'}
        color={stateColor(state?.current_state)}
        icon={<CheckIcon />}
        size="small"
      />
      {state?.is_charging && <Chip label="Charging" color="success" size="small" />}
      {state?.emergency && <Chip label="Emergency active" color="error" size="small" />}
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
              <CategorySection key={category} category={category} sensors={sensors} />
            ))}
          </Box>
        )}
      </PageContent>
    </Page>
  );
}
