import type {AppConfig, MowerConfig} from '@/components/types';
import {promises as fs} from 'fs';
import mqtt, {MqttClient} from 'mqtt';
import path from 'path';

interface Sample {
  t: number;
  v: number;
}

interface MinMax {
  min: number;
  max: number;
}

interface SensorState {
  meaningful: boolean;
  samples: Sample[];
  lastPersistedAt: number;
  latest?: number;
  loaded: boolean;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const PERSIST_INTERVAL_MS = 5 * 60 * 1000;
// same rule as the frontend's hasMeaningful24hRange: voltage/temperature drift
// meaningfully over a day, current/GPS accuracy are just noise
const MEANINGFUL_DESCRIPTIONS = new Set(['VOLTAGE', 'TEMPERATURE']);

// overridable so a Docker deployment can point this at a mounted volume
const DATA_DIR = process.env.SENSOR_HISTORY_DIR ?? path.join(process.cwd(), 'data', 'sensor-history');

function prune(samples: Sample[]): Sample[] {
  const cutoff = Date.now() - WINDOW_MS;
  return samples.filter((s) => s.t >= cutoff);
}

function fileFor(mowerId: string, sensorId: string) {
  return path.join(DATA_DIR, mowerId, `${sensorId}.json`);
}

async function loadSamples(mowerId: string, sensorId: string): Promise<Sample[]> {
  try {
    const raw = await fs.readFile(fileFor(mowerId, sensorId), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? prune(parsed) : [];
  } catch {
    return [];
  }
}

async function saveSamples(mowerId: string, sensorId: string, samples: Sample[]) {
  try {
    const file = fileFor(mowerId, sensorId);
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, JSON.stringify(samples));
  } catch (err) {
    console.error(`[sensor-history] failed to persist ${mowerId}/${sensorId}:`, err);
  }
}

// Mirrors src/lib/actions.ts' loadAppConfig, minus the header-based hostname
// fallback — there's no incoming HTTP request to read headers from here.
async function loadServerMowerConfigs(): Promise<MowerConfig[]> {
  const mqtt_ws_url = process.env.MOWER_MQTT_WS_URL;
  if (mqtt_ws_url) {
    return [
      {
        id: '1',
        name: process.env.MOWER_NAME ?? 'OpenMower',
        mqtt_ws_url,
        mqtt_prefix: process.env.MOWER_MQTT_PREFIX ?? '',
        description: '',
      },
    ];
  }
  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'config.json'), 'utf-8');
    const config: AppConfig = JSON.parse(raw);
    return config.mowers;
  } catch {
    return [];
  }
}

// One MQTT subscription + rolling 24h min/max per configured mower
class MowerRecorder {
  private client: MqttClient | null = null;
  private states = new Map<string, SensorState>();

  constructor(
    private mowerId: string,
    private mqttUrl: string,
    private prefix: string,
  ) {}

  connect() {
    const urlObj = new URL(this.mqttUrl);
    this.client = mqtt.connect(this.mqttUrl, {
      username: urlObj.username || undefined,
      password: urlObj.password || undefined,
      clean: true,
    });

    this.client.on('error', (err) => {
      console.error(`[sensor-history] mqtt error (mower ${this.mowerId}):`, err);
    });

    this.client.on('connect', () => {
      this.client!.subscribe(this.prefix + 'sensor_infos/json');
      this.client!.subscribe(this.prefix + 'sensors/+/data');
    });

    this.client.on('message', (topic, payload) => {
      const partial = topic.slice(this.prefix.length);
      if (partial === 'sensor_infos/json') {
        this.handleInfos(payload.toString());
      } else if (partial.startsWith('sensors/') && partial.endsWith('/data')) {
        const sensorId = partial.slice('sensors/'.length, -'/data'.length);
        this.handleValue(sensorId, payload.toString());
      }
    });
  }

  private handleInfos(json: string) {
    let infos: {sensor_id: string; value_description: string}[];
    try {
      infos = JSON.parse(json);
    } catch {
      return;
    }
    for (const info of infos) {
      if (this.states.has(info.sensor_id)) continue;
      const meaningful = MEANINGFUL_DESCRIPTIONS.has(info.value_description);
      const state: SensorState = {meaningful, samples: [], lastPersistedAt: 0, loaded: !meaningful};
      this.states.set(info.sensor_id, state);
      if (meaningful) {
        loadSamples(this.mowerId, info.sensor_id).then((samples) => {
          state.samples = samples;
          state.loaded = true;
        });
      }
    }
  }

  private handleValue(sensorId: string, raw: string) {
    const state = this.states.get(sensorId);
    if (!state || !state.meaningful || !state.loaded) return;
    const value = Number(raw);
    if (Number.isNaN(value)) return;
    state.latest = value;

    const now = Date.now();
    if (now - state.lastPersistedAt >= PERSIST_INTERVAL_MS || state.samples.length === 0) {
      state.samples = prune([...state.samples, {t: now, v: value}]);
      state.lastPersistedAt = now;
      saveSamples(this.mowerId, sensorId, state.samples);
    }
  }

  getAllMinMax(): Record<string, MinMax> {
    const result: Record<string, MinMax> = {};
    for (const [sensorId, state] of this.states) {
      if (!state.meaningful) continue;
      const values = state.samples.map((s) => s.v);
      if (state.latest !== undefined) values.push(state.latest);
      if (values.length === 0) continue;
      result[sensorId] = {min: Math.min(...values), max: Math.max(...values)};
    }
    return result;
  }
}

// Started lazily from the API route (not instrumentation.ts — Next.js/Turbopack's
// `output: standalone` build doesn't reliably include instrumentation.js and its
// chunks in the standalone output, so it silently never runs there). start() is
// idempotent, so calling it on every request is cheap once it's up.
class SensorHistoryRecorder {
  private recorders = new Map<string, MowerRecorder>();
  private starting: Promise<void> | null = null;

  start(): Promise<void> {
    if (!this.starting) {
      this.starting = this.doStart();
    }
    return this.starting;
  }

  private async doStart() {
    const mowers = await loadServerMowerConfigs();
    if (mowers.length === 0) {
      console.warn('[sensor-history] no mower config found (set MOWER_MQTT_WS_URL or provide config.json) — server-side 24h history disabled');
      return;
    }
    for (const mower of mowers) {
      const recorder = new MowerRecorder(mower.id, mower.mqtt_ws_url, mower.mqtt_prefix);
      recorder.connect();
      this.recorders.set(mower.id, recorder);
    }
  }

  getAllMinMax(mowerId: string): Record<string, MinMax> {
    return this.recorders.get(mowerId)?.getAllMinMax() ?? {};
  }
}

// instrumentation.ts and API routes used to be bundled as separate module graphs in
// Next.js — pin the singleton to globalThis (shared across the whole process) so every
// caller sees the same recorder regardless of which module graph pulled it in
declare global {
  var __sensorHistoryRecorder: SensorHistoryRecorder | undefined;
}

export const sensorHistoryRecorder = globalThis.__sensorHistoryRecorder ?? (globalThis.__sensorHistoryRecorder = new SensorHistoryRecorder());
