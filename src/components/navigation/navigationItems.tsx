import {type Capabilities, type NavigationItem} from '@/components/types';
import {
  BugReport as BugReportIcon,
  Dashboard as DashboardIcon,
  EventNote as EventIcon,
  Map as MapIcon,
  Sensors as SensorIcon,
} from '@mui/icons-material';

export function createNavigationItems(capabilities: Capabilities = {}): NavigationItem[] {
  const isDev = process.env.NEXT_PUBLIC_IS_DEV === 'true';
  const hasCapability = (name: string, minLevel?: number) => {
    const level = capabilities[name];
    return level !== undefined && (minLevel === undefined || level >= minLevel);
  };

  return [
    isDev && {label: 'Dashboard', icon: <DashboardIcon />, path: '/', isGlobal: true},
    {label: 'Map', icon: <MapIcon />, path: '/map', isGlobal: false},
    isDev && {label: 'Sensors', icon: <SensorIcon />, path: '/sensors', isGlobal: false},
    hasCapability('events') && {label: 'Events', icon: <EventIcon />, path: '/events', isGlobal: false},
    {label: 'Debug', icon: <BugReportIcon />, path: '/debug', isGlobal: true},
  ].filter((item): item is NavigationItem => !!item);
}
