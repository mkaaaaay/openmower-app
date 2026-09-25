'use client';

import DashboardMiniMap from '@/components/dashboard/DashboardMiniMap';
import {HeaderStat, Page, PageContent, PageHeader} from '@/components/page';
import {useComputedSpeed} from '@/hooks/useComputedSpeed';
import {outerCardStyles} from '@/lib/cardStyles';
import {useMowers, useSelectedMower, type Mower} from '@/stores/mowersStore';
import {useRouter} from 'next/navigation';
import {
  Battery90 as BatteryIcon,
  CheckCircle as CheckIcon,
  GpsFixed as GpsIcon,
  Home as HomeIcon,
  LocationOn as LocationIcon,
  PlayArrow as PlayIcon,
  SkipNext as SkipNextIcon,
  Speed as SpeedIcon,
  Stop as StopIcon,
  TrendingUp as TrendingIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import {Avatar, Box, Card, CardContent, Chip, LinearProgress, Typography, useTheme} from '@mui/material';
import {useEffect, type ReactNode} from 'react';

const ACTION_START = 'mower_logic:idle/start_mowing';
const ACTION_STOP = 'mower_logic:mowing/pause';
const ACTION_HOME = 'mower_logic:mowing/abort_mowing';
const ACTION_SKIP_AREA = 'mower_logic:mowing/skip_area';
const ACTION_RESET_EMERGENCY = 'mower_logic/reset_emergency';

// xbot_positioning.cpp hardcodes exactly 999 (meters) as "no GPS fix / EKF has no absolute pose" -
// same sentinel and same IDLE/DOCKING off-by-design states as the Sensor Dashboard (sensors/page.tsx).
const NO_GPS_FIX_VALUE = 999;
const GPS_DISABLED_BY_DESIGN_STATES = new Set(['IDLE', 'DOCKING']);

// The mini-map is only interesting while the mower is actually moving under its own power -
// otherwise it's just a static picture of a stationary marker taking up scroll space.
const MOVING_STATES = new Set(['MOWING', 'DOCKING', 'UNDOCKING']);

function ControlTile({
  icon,
  label,
  active,
  blinking = false,
  color,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  blinking?: boolean;
  color: 'primary' | 'warning' | 'secondary' | 'error';
  onClick: () => void;
}) {
  return (
    <Box
      onClick={active ? onClick : undefined}
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        py: 1.5,
        borderRadius: 2,
        cursor: active ? 'pointer' : 'default',
        color: active ? theme.palette[color].main : theme.palette.text.disabled,
        bgcolor: active ? theme.palette[color].main + '1a' : theme.palette.action.disabledBackground,
        border: '1px solid',
        borderColor: active ? theme.palette[color].main + '55' : theme.palette.divider,
        transition: 'all 0.15s ease',
        userSelect: 'none',
        '&:hover': active ? {bgcolor: theme.palette[color].main + '30'} : undefined,
        ...(blinking && {
          animation: 'dashboard-blink 1s ease-in-out infinite',
          '@keyframes dashboard-blink': {
            '0%, 100%': {opacity: 1},
            '50%': {opacity: 0.35},
          },
        }),
      })}
    >
      {icon}
      <Typography variant="caption" fontWeight={600} textAlign="center">
        {label}
      </Typography>
    </Box>
  );
}

const stateColor = (state: string | undefined) => {
  switch (state) {
    case 'MOWING':
    case 'DOCKED':
      return 'success' as const;
    case 'PAUSED':
    case 'DOCKING':
    case 'UNDOCKING':
      return 'warning' as const;
    case 'ERROR':
      return 'error' as const;
    default:
      return 'info' as const;
  }
};

const getBatteryColor = (battery: number) => {
  if (battery > 50) return 'success' as const;
  if (battery > 20) return 'warning' as const;
  return 'error' as const;
};

function MowerCard({mower}: {mower: Mower}) {
  const theme = useTheme();
  const speed = useComputedSpeed(mower.position);
  const status = stateColor(mower.state.current_state);
  const emergency = mower.state.emergency;

  const pose = mower.state.pose;
  const noGpsFix = pose !== undefined && pose.pos_accuracy >= NO_GPS_FIX_VALUE;
  const gpsOffByDesign = noGpsFix && GPS_DISABLED_BY_DESIGN_STATES.has(mower.state.current_state);
  // is_charging is only true while physically in the dock - IDLE alone can also mean "paused out
  // on the lawn", where GPS is off too but not because of the dock
  const inDockingStation = gpsOffByDesign && !!mower.state.is_charging;
  const gpsAccuracyLabel = !pose
    ? '–'
    : noGpsFix
      ? gpsOffByDesign
        ? inDockingStation
          ? 'Docked'
          : 'GPS off'
        : 'No fix'
      : `${(pose.pos_accuracy * 100).toFixed(1)} cm`;

  return (
    <Card
      sx={{
        ...outerCardStyles(theme),
        flex: '1 1 450px',
        minWidth: 0,
        transition: 'all 0.3s ease',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.16)',
        },
      }}
    >
      <CardContent>
        {/* Header with Status */}
        <Box sx={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3}}>
          <Box>
            <Typography variant="h4" component="h2" gutterBottom sx={{fontWeight: 700, color: theme.palette.text.primary}}>
              {mower.name}
            </Typography>
            <Chip label={mower.state.current_state} color={status} size="medium" sx={{fontWeight: 600, px: 2}} />
          </Box>
          <Avatar
            sx={{
              bgcolor: theme.palette[status].main,
              width: 56,
              height: 56,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
          >
            <LocationIcon />
          </Avatar>
        </Box>

        {/* Battery Status */}
        <Box sx={{mb: 4}}>
          <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2}}>
            <Box sx={{display: 'flex', alignItems: 'center', gap: 1.5}}>
              <BatteryIcon color={getBatteryColor(mower.state.battery_percentage)} sx={{fontSize: 28}} />
              <Typography variant="h6" fontWeight="600">
                Battery Status
              </Typography>
            </Box>
            <Typography variant="h4" fontWeight="bold" color={getBatteryColor(mower.state.battery_percentage)}>
              {mower.state.battery_percentage}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={mower.state.battery_percentage}
            color={getBatteryColor(mower.state.battery_percentage)}
            sx={{
              height: 12,
              borderRadius: 6,
              backgroundColor: theme.palette.grey[200],
              '& .MuiLinearProgress-bar': {borderRadius: 6},
            }}
          />
        </Box>

        {/* Controls — lit up exactly when the firmware currently allows that command (actions/json) */}
        <Box sx={{mb: 4}}>
          <Typography variant="h6" fontWeight="600" gutterBottom sx={{color: theme.palette.text.secondary}}>
            Controls
          </Typography>
          <Box sx={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 1.5}}>
            <ControlTile
              icon={<PlayIcon />}
              label="Start"
              color="primary"
              active={mower.hasAction(ACTION_START)}
              onClick={() => mower.publishAction(ACTION_START)}
            />
            <ControlTile
              icon={<StopIcon />}
              label="Stop"
              color="warning"
              active={mower.hasAction(ACTION_STOP)}
              onClick={() => mower.publishAction(ACTION_STOP)}
            />
            <ControlTile
              icon={<HomeIcon />}
              label="Go Home"
              color="secondary"
              active={mower.hasAction(ACTION_HOME)}
              onClick={() => mower.publishAction(ACTION_HOME)}
            />
            <ControlTile
              icon={<SkipNextIcon />}
              label="Skip Zone"
              color="secondary"
              active={mower.hasAction(ACTION_SKIP_AREA)}
              onClick={() => mower.publishAction(ACTION_SKIP_AREA)}
            />
            <ControlTile
              icon={<WarningIcon />}
              label="Emergency"
              color="error"
              active={emergency}
              blinking={emergency}
              onClick={() => mower.publishAction(ACTION_RESET_EMERGENCY)}
            />
          </Box>
        </Box>

        {/* Speed — computed live from position deltas, no speed field on the wire.
            RTK fix status isn't shown: the firmware knows it (AbsolutePose.flags)
            but doesn't currently include it in robot_state/json over MQTT. */}
        <Box sx={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 2}}>
          <Box sx={{textAlign: 'center', p: 2, bgcolor: theme.palette.success.light + '10', borderRadius: 2}}>
            <SpeedIcon color="success" sx={{fontSize: 24, mb: 1}} />
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Speed
            </Typography>
            <Typography variant="h6" fontWeight="600" color="success.main">
              {speed.toFixed(2)} m/s
            </Typography>
          </Box>
          <Box sx={{textAlign: 'center', p: 2, bgcolor: theme.palette.info.light + '10', borderRadius: 2}}>
            <GpsIcon color="info" sx={{fontSize: 24, mb: 1}} />
            <Typography variant="body2" color="text.secondary" gutterBottom>
              GPS Accuracy
            </Typography>
            <Typography variant="h6" fontWeight="600" color="info.main">
              {gpsAccuracyLabel}
            </Typography>
          </Box>
          <Box sx={{textAlign: 'center', p: 2, bgcolor: theme.palette.info.light + '10', borderRadius: 2}}>
            <GpsIcon color="info" sx={{fontSize: 24, mb: 1}} />
            <Typography variant="body2" color="text.secondary" gutterBottom>
              GPS Quality
            </Typography>
            <Typography variant="h6" fontWeight="600" color="info.main">
              {mower.state.gps_percentage}%
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const isDev = process.env.NEXT_PUBLIC_IS_DEV === 'true';
  const router = useRouter();

  useEffect(() => {
    if (!isDev) router.replace('/map');
  }, [isDev, router]);

  if (!isDev) return null;

  const theme = useTheme();
  const mowers = useMowers();
  const selectedMowerState = useSelectedMower((m) => m?.state.current_state);
  const showMiniMap = mowers.length > 0 && MOVING_STATES.has(selectedMowerState ?? '');

  const mowingCount = mowers.filter((m) => m.state.current_state === 'MOWING').length;
  const avgBattery = mowers.length > 0 ? Math.round(mowers.reduce((acc, m) => acc + m.state.battery_percentage, 0) / mowers.length) : 0;

  return (
    <Page>
      <PageHeader title="Dashboard" subtitle="Monitor and control your robotic lawnmowers with precision">
        <HeaderStat icon={<TrendingIcon />} value={mowers.length} label="Active Mowers" />
        <HeaderStat icon={<SpeedIcon />} value={mowingCount} label="Currently Mowing" />
        <HeaderStat icon={<CheckIcon />} value={`${avgBattery}%`} label="Avg. Battery" />
      </PageHeader>

      <PageContent>
        {showMiniMap && (
          <Card sx={{...outerCardStyles(theme), mb: 6, overflow: 'hidden'}}>
            <DashboardMiniMap sx={{height: {xs: 190, md: 320}}} />
          </Card>
        )}

        {mowers.length === 0 ? (
          <Box sx={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px'}}>
            <Typography variant="h6" color="text.secondary">
              No mowers configured. Please add mowers to your config.json file.
            </Typography>
          </Box>
        ) : (
          <Box sx={{display: 'flex', flexWrap: 'wrap', gap: 3, mb: 6}}>
            {mowers.map((mower) => (
              <MowerCard key={mower.id} mower={mower} />
            ))}
          </Box>
        )}
      </PageContent>
    </Page>
  );
}
