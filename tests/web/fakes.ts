// Browser stand-ins for jsdom: a fake microphone/MediaRecorder and a fake /api server.
import { vi } from 'vitest';
import type { MeResponse } from '../../shared/api';

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export interface FakeRequest {
  method: string;
  url: URL;
  init: RequestInit;
}
type Route = ((req: FakeRequest) => Response | Promise<Response>) | object;

export function mockServer(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const route = routes[`${method} ${url.pathname}`];
    if (!route) return json({ error: { code: 'not_found', message: `${method} ${url.pathname}` } }, 404);
    return typeof route === 'function' ? route({ method, url, init }) : json(route);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function callsTo(fetchMock: ReturnType<typeof mockServer>, method: string, path: string) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const url = new URL(String(input), 'http://localhost');
    return url.pathname === path && ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === method;
  });
}

export const ME: MeResponse = {
  user: { id: 2, username: 'sara', role: 'user', enhanceAllowed: true },
  usage: {
    daySeconds: 60,
    dayLimitSeconds: 1800,
    monthSeconds: 600,
    monthLimitSeconds: 18000,
    enhanceToday: 0,
    enhanceDailyLimit: 200,
    day: '2026-10-16',
    month: '2026-10',
    timeZone: 'UTC',
  },
  features: {
    enhancementAvailable: true,
    keytermsAvailable: true,
    maxRecordingSeconds: 300,
    maxUploadBytes: 25 * 1024 * 1024,
    pricing: { audioPerHourUsd: 0.22, keytermsPerHourUsd: 0.05 },
  },
};

export interface FakeMedia {
  getUserMedia: ReturnType<typeof vi.fn>;
  trackStop: ReturnType<typeof vi.fn>;
  recorders: FakeMediaRecorder[];
}

class FakeMediaRecorder {
  static isTypeSupported = (t: string) => t.startsWith('audio/webm');
  static instances: FakeMediaRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(3000)], { type: this.mimeType }) });
    setTimeout(() => this.onstop?.(), 0);
  }
}

/** Installs a fake microphone. With `silent`, the level meter only ever sees silence. */
export function installFakeMedia({ silent = false } = {}): FakeMedia {
  const trackStop = vi.fn();
  const track = { stop: trackStop, readyState: 'live' };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: vi.fn().mockResolvedValue([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  FakeMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal(
    'AudioContext',
    class {
      createMediaStreamSource() {
        return { connect() {} };
      }
      createAnalyser() {
        return {
          fftSize: 1024,
          getFloatTimeDomainData(buf: Float32Array) {
            buf.fill(silent ? 0 : 0.25);
          },
        };
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    },
  );
  return { getUserMedia, trackStop, recorders: FakeMediaRecorder.instances };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
