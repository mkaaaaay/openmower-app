'use client';

import {TooltipTextField} from '@/components/ui/TooltipTextField';
import {displaySortKey, useMap, useMapboxDraw, useMapContext, useMapSelection} from '@/contexts/MapContext';
import {useJobTrack} from '@/hooks/useJobTrack';
import {useMapDisplayStore} from '@/stores/mapDisplayStore';
import {useMowAngleCalibrationStore} from '@/stores/mowAngleCalibrationStore';
import {useSelectedMower} from '@/stores/mowersStore';
import {AreaProps, areaSchema} from '@/stores/schemas';
import {computeDominantBearing} from '@/utils/mow-angle-calibration';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import {ExpandMore as ExpandMoreIcon, InfoOutlined as InfoOutlinedIcon} from '@mui/icons-material';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Switch,
  TextField,
  Tooltip,
  tooltipClasses,
  Typography,
} from '@mui/material';
import {useEffect, useMemo, useState} from 'react';
import {AsyncDialogProps} from 'react-dialog-async';
import {z} from 'zod/v4';
import MapDialog from '../MapDialog';

// used when the mower hasn't reported its configured tool width yet
const DEFAULT_TOOL_WIDTH_METERS = 0.2;
const infoTooltipSlotProps = {
  tooltip: {
    sx: {
      bgcolor: 'grey.900',
      color: 'common.white',
      fontSize: '0.8rem',
      lineHeight: 1.5,
      maxWidth: 260,
      px: 1.5,
      py: 1,
      [`& .${tooltipClasses.arrow}`]: {color: 'grey.900'},
    },
  },
};

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

// Format a stored radian angle as a degrees string for the input (2 decimals, no trailing noise).
function radToDegString(rad: number): string {
  return String(Math.round(rad * RAD_TO_DEG * 100) / 100);
}

export function AreaSettingsDialog({isOpen, handleClose}: AsyncDialogProps) {
  const map = useMap();
  const draw = useMapboxDraw();
  const {features} = useMapContext();
  const selectedIds = useMapSelection();
  const [name, setName] = useState('');
  const [type, setType] = useState<AreaProps['type']>('draft');
  const [active, setActive] = useState(true);
  // Per-area mowing overrides — kept as strings so an empty field means "use the global default".
  const [outlineCount, setOutlineCount] = useState('');
  const [outlineOverlapCount, setOutlineOverlapCount] = useState('');
  const [outlineOffset, setOutlineOffset] = useState('');
  const [angleDeg, setAngleDeg] = useState('');
  // The angle actually saved for this area when the dialog opened - unlike angleDeg (which the
  // slider live-edits for the preview), this stays fixed, so "calibrate from last mow" can use the
  // angle that was really configured when that mow ran, even mid-drag.
  const [originalAngleDeg, setOriginalAngleDeg] = useState<number | null>(null);
  // Overrides are collapsed by default, expanded automatically when the area already has any set.
  const [overridesExpanded, setOverridesExpanded] = useState(false);
  // Fades the dialog out while dragging the angle slider, so the stripe preview underneath is
  // actually visible instead of being hidden behind the dialog itself.
  const [previewingAngle, setPreviewingAngle] = useState(false);

  // Initialize form values when dialog opens or selected area changes
  useEffect(() => {
    if (selectedIds.length === 0 || !draw) return;
    const selectedArea = draw!.get(selectedIds[0]);
    const properties = selectedArea!.properties! as AreaProps;
    setName(properties.name ?? '');
    setType(properties.type ?? 'draft');
    setActive(properties.active ?? true);
    setOutlineCount(properties.outline_count != null ? String(properties.outline_count) : '');
    setOutlineOverlapCount(properties.outline_overlap_count != null ? String(properties.outline_overlap_count) : '');
    setOutlineOffset(properties.outline_offset != null ? String(properties.outline_offset) : '');
    setAngleDeg(properties.angle != null ? radToDegString(properties.angle) : '');
    setOriginalAngleDeg(properties.angle != null ? Math.round(properties.angle * RAD_TO_DEG * 100) / 100 : null);
    setOverridesExpanded(
      properties.outline_count != null ||
        properties.outline_overlap_count != null ||
        properties.outline_offset != null ||
        properties.angle != null,
    );
  }, [draw, selectedIds]);

  const overrideCount = [outlineCount, outlineOverlapCount, outlineOffset, angleDeg].filter(
    (v) => v.trim() !== '',
  ).length;

  const setStripePreview = useMapDisplayStore((s) => s.setStripePreview);
  const toolWidth = useSelectedMower((m) => m?.params['/mower_logic/tool_width']);
  const mowerId = useSelectedMower((m) => m?.id);
  const calibration = useMowAngleCalibrationStore((s) => (mowerId ? s.calibrations[mowerId] : undefined));
  const setMowAngleCalibration = useMowAngleCalibrationStore((s) => s.setCalibration);
  const fetchMowAngleCalibration = useMowAngleCalibrationStore((s) => s.fetchCalibration);
  const isCalibrated = calibration !== undefined;
  // A manual angle only means something once we've seen how this mower actually interprets it -
  // before the first completed job, force auto-detect (empty angle) instead of letting the user
  // set a value neither the real mow nor the preview can back up yet.
  const jobList = useSelectedMower((m) => m?.jobList);
  const liveJobId = useSelectedMower((m) => m?.track.attributes.job_id);
  const hasCompletedJob = (jobList ?? []).some((j) => j.job_id !== liveJobId);

  useEffect(() => {
    if (mowerId) void fetchMowAngleCalibration(mowerId);
  }, [mowerId, fetchMowAngleCalibration]);

  // "Calibrate from last mow": the most recently completed job, assumed to have used this area's
  // currently saved angle (originalAngleDeg) - the app has no record of a job's angle after the
  // fact, so this is a best-effort guess, not a certainty. Low-stakes if wrong (it only affects
  // this preview, not the real mow), so kept as a single one-click action rather than exposing the
  // guess for confirmation - just recalibrate again if the preview still looks off.
  const mostRecentPastJobId = (jobList ?? []).find((j) => j.job_id !== liveJobId)?.job_id ?? null;
  const {pastTrack: lastJobTrack} = useJobTrack(mostRecentPastJobId);
  const lastJobBearing = useMemo(
    () => (lastJobTrack ? computeDominantBearing(lastJobTrack.segments) : null),
    [lastJobTrack],
  );

  const canCalibrateFromLastJob = hasCompletedJob && lastJobBearing !== null && originalAngleDeg != null;
  const [calibrating, setCalibrating] = useState(false);

  const handleCalibrateFromLastJob = async () => {
    if (!mowerId || !mostRecentPastJobId || !lastJobBearing || originalAngleDeg == null) return;
    setCalibrating(true);
    try {
      const offsetDeg = (((lastJobBearing.bearingDeg - originalAngleDeg) % 180) + 180) % 180;
      await setMowAngleCalibration(mowerId, {
        offsetDeg,
        angleDegUsed: originalAngleDeg,
        measuredBearingDeg: lastJobBearing.bearingDeg,
        jobId: mostRecentPastJobId,
        distanceMeters: lastJobBearing.totalDistanceMeters,
        calibratedAt: Date.now(),
      });
    } finally {
      setCalibrating(false);
    }
  };

  // Live "what would this angle look like" preview on the map while the slider/field is being
  // dragged. Only possible once angle is actually set - "Auto-detect" has no client-side answer.
  useEffect(() => {
    if (!isOpen || type !== 'mow' || selectedIds.length === 0 || angleDeg.trim() === '' || !hasCompletedJob) {
      setStripePreview(null);
      return;
    }
    const parsed = Number(angleDeg);
    if (!Number.isFinite(parsed)) {
      setStripePreview(null);
      return;
    }
    setStripePreview({
      areaId: String(selectedIds[0]),
      angleDeg: parsed,
      spacingMeters: toolWidth ?? DEFAULT_TOOL_WIDTH_METERS,
    });
  }, [isOpen, type, selectedIds, angleDeg, toolWidth, setStripePreview, hasCompletedJob]);

  // Clear the preview on unmount too, in case the dialog gets torn down without isOpen flipping
  // false first (react-dialog-async keeps it mounted between opens).
  useEffect(() => () => setStripePreview(null), [setStripePreview]);

  const propsShape = areaSchema.shape.properties.shape;
  const angleDegSchema = z.number().min(-180).max(180);
  const validateField = (
    schema: {safeParse: (v: unknown) => {success: boolean; error?: {issues: {message: string}[]}}},
    raw: string,
  ): string => {
    if (raw.trim() === '') return '';
    const result = schema.safeParse(Number(raw));
    return result.success ? '' : (result.error?.issues[0].message ?? 'Invalid value');
  };
  const outlineCountError = validateField(propsShape.outline_count, outlineCount);
  const outlineOverlapCountError = validateField(propsShape.outline_overlap_count, outlineOverlapCount);
  const outlineOffsetError = validateField(propsShape.outline_offset, outlineOffset);
  const angleDegError = validateField(angleDegSchema, angleDeg);
  const hasErrors = !!(outlineCountError || outlineOverlapCountError || outlineOffsetError || angleDegError);

  const handleSave = () => {
    if (!map || !draw || selectedIds.length === 0) return;

    const feature = draw.get(selectedIds[0])!;
    const index = features.features.findIndex((f) => f.id === feature.id);
    const properties: Record<string, unknown> = {
      ...feature.properties,
      name,
      type,
      active,
      sort_key: displaySortKey(index, type, features.features),
    };

    // Per-area mowing overrides. An empty input (or a non-mowing area) removes the key entirely so
    // ROS falls back to the global config default. map.json stores angle in radians.
    const applyOverride = (key: string, raw: string, parse: (s: string) => number) => {
      const value = type === 'mow' ? parse(raw.trim()) : NaN;
      if (Number.isFinite(value)) {
        properties[key] = value;
      } else {
        delete properties[key];
      }
    };
    applyOverride('outline_count', outlineCount, (s) => parseInt(s, 10));
    applyOverride('outline_overlap_count', outlineOverlapCount, (s) => parseInt(s, 10));
    applyOverride('outline_offset', outlineOffset, (s) => parseFloat(s));
    applyOverride('angle', angleDeg, (s) => parseFloat(s) * DEG_TO_RAD);

    feature.properties = properties;
    draw.add(feature);
    map.fire(MapboxDraw.constants.events.UPDATE, {features: [feature]});

    handleClose();
  };

  if (selectedIds.length === 0) {
    return null;
  }

  return (
    <MapDialog
      open={isOpen}
      onClose={() => handleClose()}
      fullWidth
      maxWidth="xs"
      slotProps={{
        paper: {sx: {transition: 'opacity 0.15s', opacity: previewingAngle ? 0.12 : 1}},
        backdrop: {sx: {transition: 'opacity 0.15s', opacity: previewingAngle ? 0 : 1}},
      }}
    >
      <DialogTitle>Area Settings</DialogTitle>
      <DialogContent>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          margin="normal"
          variant="outlined"
          required
        />

        <FormControl fullWidth margin="normal">
          <InputLabel>Type</InputLabel>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as AreaProps['type'])}
            label="Type"
            MenuProps={{
              disablePortal: true,
            }}
          >
            <MenuItem value="mow">Mowing Area</MenuItem>
            <MenuItem value="nav">Navigation Area</MenuItem>
            <MenuItem value="obstacle">Obstacle</MenuItem>
            <MenuItem value="draft">Draft</MenuItem>
          </Select>
        </FormControl>

        <FormControlLabel
          control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
          label="Active"
          sx={{mt: 2}}
        />

        {type === 'mow' && (
          <Accordion
            expanded={overridesExpanded}
            onChange={(_, expanded) => setOverridesExpanded(expanded)}
            disableGutters
            sx={{
              mt: 2,
              '&:before': {display: 'none'},
              borderRadius: '8px !important',
              overflow: 'hidden',
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: 'none',
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              sx={{bgcolor: 'background.paper', '&:hover': {bgcolor: 'action.hover'}, minHeight: 48}}
            >
              <Box sx={{display: 'flex', alignItems: 'center', gap: 1.5, flex: 1}}>
                <Typography variant="subtitle2" fontWeight={600}>
                  Mowing settings overrides
                </Typography>
                {overrideCount > 0 && (
                  <Chip label={overrideCount} size="small" color="primary" sx={{height: 20, minWidth: 20}} />
                )}
                <Box sx={{flex: 1}} />
                <Tooltip
                  title="When non-empty, these values override the global mowing settings."
                  enterTouchDelay={0}
                  leaveTouchDelay={4000}
                  placement="top"
                  slotProps={{
                    tooltip: {
                      sx: {
                        bgcolor: 'grey.900',
                        color: 'common.white',
                        fontSize: '0.8rem',
                        lineHeight: 1.5,
                        maxWidth: 260,
                        px: 1.5,
                        py: 1,
                        [`& .${tooltipClasses.arrow}`]: {color: 'grey.900'},
                      },
                    },
                  }}
                  arrow
                >
                  <span onClick={(e) => e.stopPropagation()}>
                    <IconButton size="small" tabIndex={-1} component="span">
                      <InfoOutlinedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{pt: 0}}>
              <Box sx={{display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 1}}>
                <TooltipTextField
                  label="Outline count"
                  type="number"
                  value={outlineCount}
                  onChange={(e) => setOutlineCount(e.target.value)}
                  fullWidth
                  margin="normal"
                  placeholder="Global default"
                  inputProps={{min: 0, step: 1}}
                  slotProps={{inputLabel: {shrink: true}}}
                  sx={{
                    '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {display: 'none'},
                    '& input[type=number]': {MozAppearance: 'textfield'},
                  }}
                  error={!!outlineCountError}
                  helperText={outlineCountError}
                  tooltip="How many outlines should the mower drive. It's not recommended to set this below 4."
                />
                <TooltipTextField
                  label="Outline overlap count"
                  type="number"
                  value={outlineOverlapCount}
                  onChange={(e) => setOutlineOverlapCount(e.target.value)}
                  fullWidth
                  margin="normal"
                  placeholder="Global default"
                  inputProps={{min: 0, step: 1}}
                  slotProps={{inputLabel: {shrink: true}}}
                  sx={{
                    '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {display: 'none'},
                    '& input[type=number]': {MozAppearance: 'textfield'},
                  }}
                  error={!!outlineOverlapCountError}
                  helperText={outlineOverlapCountError}
                  tooltip="Number of outlines to overlap."
                />
                <TooltipTextField
                  label="Outline offset (m)"
                  type="number"
                  value={outlineOffset}
                  onChange={(e) => setOutlineOffset(e.target.value)}
                  fullWidth
                  margin="normal"
                  placeholder="Global default"
                  inputProps={{step: 0.01}}
                  slotProps={{inputLabel: {shrink: true}}}
                  sx={{
                    '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {display: 'none'},
                    '& input[type=number]': {MozAppearance: 'textfield'},
                  }}
                  error={!!outlineOffsetError}
                  helperText={outlineOffsetError}
                  tooltip="Offset applied to the outline. Positive values move it inwards (i.e. safety margin)."
                />
                <TooltipTextField
                  label="Mow angle (°)"
                  type="number"
                  value={angleDeg}
                  onChange={(e) => setAngleDeg(e.target.value)}
                  fullWidth
                  margin="normal"
                  placeholder="Auto-detect"
                  disabled={!hasCompletedJob}
                  inputProps={{min: -180, max: 180, step: 'any'}}
                  slotProps={{inputLabel: {shrink: true}}}
                  sx={{
                    '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {display: 'none'},
                    '& input[type=number]': {MozAppearance: 'textfield'},
                  }}
                  error={!!angleDegError}
                  helperText={angleDegError}
                  tooltip="Fixed mowing direction (0° = east). Empty = auto-detect from the first 2 m of the outline."
                />
              </Box>
              {!hasCompletedJob ? (
                <Typography variant="caption" color="text.secondary" sx={{display: 'block', mt: 0.5}}>
                  A fixed mow angle (and its preview) unlocks after the mower has completed at least one full mow —
                  until then it auto-detects the direction from the outline.
                </Typography>
              ) : (
                <>
                  <Box sx={{mt: 1}}>
                    <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}>
                      <Typography variant="caption" color="text.secondary" sx={{whiteSpace: 'nowrap'}}>
                        Preview angle
                      </Typography>
                      <Tooltip
                        title="Draws an approximate stripe preview on the map for this angle. Only works if the area's outline has already been recorded/drawn - and ignores obstacles inside it, unlike the real mowing plan."
                        enterTouchDelay={0}
                        leaveTouchDelay={4000}
                        placement="top"
                        slotProps={infoTooltipSlotProps}
                        arrow
                      >
                        <IconButton size="small" tabIndex={-1}>
                          <InfoOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                    {/* Full dialog width instead of sharing the row with the label/info icon - on a
                        phone-width dialog, cramming a -180..180 range into a shorter track made
                        small touch movements jump several degrees at once. */}
                    <Slider
                      size="small"
                      min={-180}
                      max={180}
                      step={1}
                      value={angleDeg.trim() === '' ? 0 : Number(angleDeg)}
                      onChange={(_, value) => {
                        setAngleDeg(String(value));
                        setPreviewingAngle(true);
                      }}
                      onChangeCommitted={() => setPreviewingAngle(false)}
                      valueLabelDisplay="auto"
                      valueLabelFormat={(v) => `${v}°`}
                      sx={{mx: 1, width: 'calc(100% - 16px)'}}
                    />
                  </Box>
                  <Box sx={{display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap'}}>
                    <Typography variant="caption" color="text.secondary">
                      {isCalibrated ? 'Preview calibrated.' : 'Uncalibrated preview — direction may be off.'}
                    </Typography>
                    <Tooltip
                      title={
                        isCalibrated && calibration
                          ? `Offset ${calibration.offsetDeg.toFixed(1)}°, from a job mowed at ${calibration.angleDegUsed}° that measured ${calibration.measuredBearingDeg.toFixed(1)}° (${calibration.distanceMeters.toFixed(0)} m of straight mowing). This mower's own positioning setup can add a fixed offset between the angle you set and the real direction - calibrating once from a completed mow corrects for it.`
                          : "This mower's own positioning setup can add a fixed offset between the angle you set and the real mowed direction. Calibrating once from a completed mow (using its currently saved angle) corrects the preview for it."
                      }
                      enterTouchDelay={0}
                      leaveTouchDelay={6000}
                      placement="top"
                      slotProps={infoTooltipSlotProps}
                      arrow
                    >
                      <IconButton size="small" tabIndex={-1}>
                        <InfoOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {canCalibrateFromLastJob ? (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => void handleCalibrateFromLastJob()}
                        disabled={calibrating}
                      >
                        {isCalibrated ? 'Recalibrate' : 'Calibrate'}
                      </Button>
                    ) : (
                      !isCalibrated && (
                        <Typography variant="caption" color="text.secondary">
                          (needs a full mow with a fixed angle first)
                        </Typography>
                      )
                    )}
                  </Box>
                </>
              )}
            </AccordionDetails>
          </Accordion>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => handleClose()}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={name === '' || hasErrors}>
          Save
        </Button>
      </DialogActions>
    </MapDialog>
  );
}
