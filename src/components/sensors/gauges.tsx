'use client';

import type {SensorInfo} from '@/stores/schemas';

export interface GaugeZone {
  from: number;
  to: number;
  color: string;
}

export interface GaugeScale {
  domainMin: number;
  domainMax: number;
  zones: GaugeZone[];
}

const RED = '#e53935';
const YELLOW = '#fbc02d';
const GREEN = '#43a047';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// The firmware's "unset" sentinel for every threshold is -1, but the code that sets
// has_critical_low/has_critical_high only checks "value != 0" — so an unresolved sentinel can
// leak through as has_critical_high: true, upper_critical_value: -1, which would make every real
// (non-negative) reading look permanently critical. Treat negative thresholds as unset here.
export function computeGaugeScale(info: SensorInfo): GaugeScale | null {
  const hasCriticalLow = info.has_critical_low && info.lower_critical_value >= 0;
  const hasCriticalHigh = info.has_critical_high && info.upper_critical_value >= 0;
  const hasMinMax = info.has_min_max && info.min_value >= 0 && info.max_value >= 0;
  if (!hasMinMax && !hasCriticalLow && !hasCriticalHigh) return null;

  const lowBound = hasCriticalLow ? info.lower_critical_value : hasMinMax ? info.min_value : 0;
  const highBound = hasCriticalHigh ? info.upper_critical_value : hasMinMax ? info.max_value : lowBound + 1;

  const span = highBound - lowBound || 1;
  const pad = span * 0.15;
  const domainMin = Math.max(0, lowBound - pad);
  const domainMax = highBound + pad;

  const zones: GaugeZone[] = [];
  if (hasCriticalLow) {
    zones.push({from: domainMin, to: info.lower_critical_value, color: RED});
  }
  if (hasMinMax) {
    const yellowLowStart = hasCriticalLow ? info.lower_critical_value : domainMin;
    if (yellowLowStart < info.min_value) zones.push({from: yellowLowStart, to: info.min_value, color: YELLOW});
    zones.push({from: info.min_value, to: info.max_value, color: GREEN});
    const yellowHighEnd = hasCriticalHigh ? info.upper_critical_value : domainMax;
    if (info.max_value < yellowHighEnd) zones.push({from: info.max_value, to: yellowHighEnd, color: YELLOW});
  } else {
    const midStart = hasCriticalLow ? info.lower_critical_value : domainMin;
    const midEnd = hasCriticalHigh ? info.upper_critical_value : domainMax;
    if (midEnd > midStart) zones.push({from: midStart, to: midEnd, color: GREEN});
  }
  if (hasCriticalHigh) {
    zones.push({from: info.upper_critical_value, to: domainMax, color: RED});
  }

  return {domainMin, domainMax, zones};
}

export function fallbackGaugeScale(value: number): GaugeScale {
  const domainMax = value > 0 ? value * 1.5 : 1;
  return {domainMin: 0, domainMax, zones: [{from: 0, to: domainMax, color: GREEN}]};
}

const fractionOf = (value: number, scale: GaugeScale) => {
  const span = scale.domainMax - scale.domainMin || 1;
  return clamp((value - scale.domainMin) / span, 0, 1);
};

const genTicks = (scale: GaugeScale, count = 5) =>
  Array.from({length: count}, (_, i) => scale.domainMin + ((scale.domainMax - scale.domainMin) * i) / (count - 1));

const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2));

export function VerticalGauge({value, scale, width = 70, height = 120}: {value: number; scale: GaugeScale; width?: number; height?: number}) {
  const barX = 6;
  const barWidth = 12;
  const frac = fractionOf(value, scale);
  const pointerY = height - frac * height;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <rect x={barX} y={0} width={barWidth} height={height} fill="#e0e0e0" />
      {scale.zones.map((zone, i) => {
        const y1 = height - fractionOf(zone.to, scale) * height;
        const y2 = height - fractionOf(zone.from, scale) * height;
        return <rect key={i} x={barX} y={y1} width={barWidth} height={Math.max(0, y2 - y1)} fill={zone.color} />;
      })}
      <polygon
        points={`${barX + barWidth + 2},${pointerY} ${barX + barWidth + 9},${pointerY - 5} ${barX + barWidth + 9},${pointerY + 5}`}
        fill="#616161"
      />
      {genTicks(scale).map((t, i) => (
        <text key={i} x={barX + barWidth + 12} y={height - fractionOf(t, scale) * height + 3} fontSize="8" fill="#888">
          {fmt(t)}
        </text>
      ))}
    </svg>
  );
}

const TEMP_GRADIENT_ID = 'sensor-temp-gauge-gradient';

interface HorizontalGaugeProps {
  value: number;
  // falls back to min/max + rainbow gradient when omitted
  scale?: GaugeScale;
  min?: number;
  max?: number;
  width?: number;
  height?: number;
}

export function HorizontalGauge({value, scale, min = 0, max = 100, width = 180, height = 34}: HorizontalGaugeProps) {
  const barY = 6;
  const barHeight = 12;
  const effectiveScale = scale ?? {domainMin: min, domainMax: max, zones: []};
  const frac = fractionOf(value, effectiveScale);
  const pointerX = frac * width;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {scale ? (
        <>
          <rect x={0} y={barY} width={width} height={barHeight} fill="#e0e0e0" rx={2} />
          {scale.zones.map((zone, i) => {
            const x1 = fractionOf(zone.from, scale) * width;
            const x2 = fractionOf(zone.to, scale) * width;
            return <rect key={i} x={x1} y={barY} width={Math.max(0, x2 - x1)} height={barHeight} fill={zone.color} />;
          })}
        </>
      ) : (
        <>
          <defs>
            <linearGradient id={TEMP_GRADIENT_ID} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#2979ff" />
              <stop offset="25%" stopColor="#00bcd4" />
              <stop offset="50%" stopColor="#43a047" />
              <stop offset="75%" stopColor="#fbc02d" />
              <stop offset="100%" stopColor="#e53935" />
            </linearGradient>
          </defs>
          <rect x={0} y={barY} width={width} height={barHeight} fill={`url(#${TEMP_GRADIENT_ID})`} rx={2} />
        </>
      )}
      <polygon points={`${pointerX},${barY - 2} ${pointerX - 5},${barY - 8} ${pointerX + 5},${barY - 8}`} fill="#616161" />
      {(scale ? genTicks(scale) : [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (max - min))).map((t, i, arr) => (
        <text
          key={i}
          x={clamp(fractionOf(t, effectiveScale) * width, 8, width - 8)}
          y={height}
          fontSize="8"
          fill="#888"
          textAnchor={i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}
        >
          {fmt(t)}
        </text>
      ))}
    </svg>
  );
}

export function RadialGauge({value, scale, size = 120}: {value: number; scale: GaugeScale; size?: number}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 16;
  const startAngle = 135; // degrees; 0 = east, clockwise. Gauge opens at the bottom.
  const sweep = 270;

  const angleFor = (frac: number) => (startAngle + frac * sweep) * (Math.PI / 180);
  const point = (frac: number): [number, number] => {
    const a = angleFor(frac);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  const arcPath = (fromFrac: number, toFrac: number) => {
    const [x1, y1] = point(fromFrac);
    const [x2, y2] = point(toFrac);
    const large = (toFrac - fromFrac) * sweep > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  const frac = fractionOf(value, scale);
  const needleAngle = angleFor(frac);
  const needleLen = r - 4;
  const needleX = cx + needleLen * Math.cos(needleAngle);
  const needleY = cy + needleLen * Math.sin(needleAngle);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {scale.zones.map((zone, i) => (
        <path
          key={i}
          d={arcPath(fractionOf(zone.from, scale), fractionOf(zone.to, scale))}
          stroke={zone.color}
          strokeWidth={10}
          fill="none"
        />
      ))}
      <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke="#616161" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={4} fill="#616161" />
    </svg>
  );
}
