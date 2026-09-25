'use client';

import {outerCardStyles} from '@/lib/cardStyles';
import {useSelectedMower, type Mower} from '@/stores/mowersStore';
import {ExpandLess as CollapseIcon, ExpandMore as ExpandIcon} from '@mui/icons-material';
import {Box, Card, CardContent, IconButton, Typography, useTheme} from '@mui/material';
import {useState, type ReactNode} from 'react';

const PREFIX = 'mower_logic:area_recording/';

interface ActionDef {
  id: string;
  label: string;
  color: 'primary' | 'warning' | 'secondary' | 'error' | 'success';
}

const RECORDING_ACTIONS: ActionDef[] = [
  {id: `${PREFIX}start_recording`, label: 'Start Recording', color: 'primary'},
  {id: `${PREFIX}stop_recording`, label: 'Stop Recording', color: 'warning'},
  {id: `${PREFIX}collect_point`, label: 'Collect Point', color: 'secondary'},
  {id: `${PREFIX}auto_point_collecting_enable`, label: 'Auto-Collect On', color: 'success'},
  {id: `${PREFIX}auto_point_collecting_disable`, label: 'Auto-Collect Off', color: 'success'},
  {id: `${PREFIX}finish_mowing_area`, label: 'Save as Mowing Area', color: 'success'},
  {id: `${PREFIX}finish_navigation_area`, label: 'Save as Navigation Area', color: 'success'},
  {id: `${PREFIX}record_dock`, label: 'Record Docking Point', color: 'secondary'},
  {id: `${PREFIX}start_manual_mowing`, label: 'Start Test Mowing', color: 'primary'},
  {id: `${PREFIX}stop_manual_mowing`, label: 'Stop Test Mowing', color: 'warning'},
  {id: `${PREFIX}finish_discard`, label: 'Discard Area', color: 'error'},
  {id: `${PREFIX}exit_recording_mode`, label: 'Exit', color: 'error'},
];

function ActionButton({label, active, color, onClick}: {label: string; active: boolean; color: ActionDef['color']; onClick: () => void}) {
  return (
    <Box
      onClick={active ? onClick : undefined}
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        px: 1.5,
        py: 1.25,
        borderRadius: 1.5,
        fontSize: '0.8rem',
        fontWeight: 600,
        cursor: active ? 'pointer' : 'default',
        userSelect: 'none',
        color: active ? theme.palette[color].main : theme.palette.text.disabled,
        bgcolor: active ? theme.palette[color].main + '1a' : theme.palette.action.disabledBackground,
        border: '1px solid',
        borderColor: active ? theme.palette[color].main + '55' : theme.palette.divider,
        transition: 'all 0.15s ease',
        '&:hover': active ? {bgcolor: theme.palette[color].main + '30'} : undefined,
      })}
    >
      {label}
    </Box>
  );
}

interface AreaRecordingPanelProps {
  children?: ReactNode;
  /** 'sidebar' (default): fixed right-hand panel, for desktop where there's room next to the map.
   *  'sheet': collapsible bar pinned to the top of the map — used on mobile, where a fixed panel
   *  would otherwise cover the map and the joystick you need to see while driving. */
  variant?: 'sidebar' | 'sheet';
}

/** Floating panel with every mower_logic:area_recording/* action, lit up exactly per the live actions/json flags. */
export default function AreaRecordingPanel({children, variant = 'sidebar'}: AreaRecordingPanelProps) {
  const theme = useTheme();
  const mower = useSelectedMower<Mower | undefined>((m) => m);
  const [expanded, setExpanded] = useState(false);

  if (!mower) return null;

  const renderButtons = (afterClick?: () => void) => (
    <Box sx={{display: 'flex', flexDirection: 'column', gap: 1}}>
      {RECORDING_ACTIONS.map((action) => (
        <ActionButton
          key={action.id}
          label={action.label}
          color={action.color}
          active={mower.hasAction(action.id)}
          onClick={() => {
            mower.publishAction(action.id);
            afterClick?.();
          }}
        />
      ))}
    </Box>
  );

  if (variant === 'sheet') {
    return (
      <Box sx={{position: 'absolute', top: 10, left: 10, right: 60, zIndex: 5}}>
        <Card sx={{...outerCardStyles(theme), maxHeight: expanded ? '60vh' : 'auto', overflow: 'auto'}}>
          <Box
            onClick={() => setExpanded((e) => !e)}
            sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, cursor: 'pointer'}}
          >
            <Typography variant="subtitle2" fontWeight={700}>
              Area Recording
            </Typography>
            <IconButton size="small">{expanded ? <CollapseIcon /> : <ExpandIcon />}</IconButton>
          </Box>
          {expanded && (
            <CardContent sx={{pt: 0}}>
              <Typography variant="body2" color="text.secondary" sx={{mb: 2}}>
                Drive with the joystick while the outline is recorded. Collapses automatically after each action.
              </Typography>
              {renderButtons(() => setExpanded(false))}
              {children}
            </CardContent>
          )}
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{position: 'absolute', top: 10, right: 60, bottom: 10, width: 320}}>
      <Card sx={{...outerCardStyles(theme), height: '100%', overflow: 'auto'}}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            Area Recording
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{mb: 2}}>
            Drive with the joystick below while the outline is recorded.
          </Typography>
          {renderButtons()}
          {children}
        </CardContent>
      </Card>
    </Box>
  );
}
