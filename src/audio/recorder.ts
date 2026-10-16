// Microphone capture with MediaRecorder plus a live input level for the on-screen meter.

export interface Recording {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  /** Loudest level seen during the recording, 0..1. Used to skip silent recordings. */
  peakLevel: number;
}

/** Below this peak level we assume nothing was said. */
export const SILENCE_THRESHOLD = 0.08;

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus', // Chrome, Edge, Firefox, Android
  'audio/ogg;codecs=opus', // older Firefox
  'audio/mp4;codecs=mp4a.40.2', // Safari (macOS and iOS)
  'audio/mp4',
  'audio/webm',
];

export function pickMimeType(
  isSupported: (type: string) => boolean = (t) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
): string | undefined {
  return MIME_CANDIDATES.find((t) => {
    try {
      return isSupported(t);
    } catch {
      return false;
    }
  });
}

export function recordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export class MicrophoneError extends Error {
  readonly kind: 'denied' | 'not_found' | 'busy' | 'insecure' | 'unsupported' | 'unknown';
  constructor(kind: MicrophoneError['kind'], message: string) {
    super(message);
    this.name = 'MicrophoneError';
    this.kind = kind;
  }
}

export function toMicrophoneError(err: unknown): MicrophoneError {
  if (err instanceof MicrophoneError) return err;
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return new MicrophoneError(
        'denied',
        'Microphone access is blocked. Click the lock or site-settings icon in the address bar, allow the microphone, then try again.',
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new MicrophoneError('not_found', 'No microphone was found. Plug one in or pick another in Settings.');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new MicrophoneError(
        'busy',
        'The microphone could not be started. Another app may be using it; close it and try again.',
      );
    case 'SecurityError':
      return new MicrophoneError('insecure', 'The microphone only works on a secure (https) page.');
    default:
      return new MicrophoneError('unknown', 'The microphone could not be started. Please try again.');
  }
}

export interface RecorderOptions {
  deviceId?: string;
  onLevel?: (level: number) => void;
}

export class Recorder {
  private stream: MediaStream | null = null;
  private streamDeviceId: string | undefined;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelTimer: number | null = null;
  private startedAt = 0;
  private peak = 0;
  private onLevel?: (level: number) => void;

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  async start(opts: RecorderOptions = {}): Promise<void> {
    if (!recordingSupported()) {
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        throw new MicrophoneError('insecure', 'The microphone only works on a secure (https) page.');
      }
      throw new MicrophoneError(
        'unsupported',
        'This browser cannot record audio. Please use a recent Chrome, Edge, Firefox or Safari.',
      );
    }
    if (this.isRecording) return;
    this.onLevel = opts.onLevel;
    const stream = await this.acquire(opts.deviceId);

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 48_000,
      });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    this.chunks = [];
    this.peak = 0;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder = recorder;
    this.startMeter(stream);
    recorder.start(250);
    this.startedAt = performance.now();
  }

  /** Stops recording. Keeps the microphone open when `keepOpen` is true for a faster next start. */
  stop(keepOpen = false): Promise<Recording | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      if (!keepOpen) this.release();
      return Promise.resolve(null);
    }
    const durationSeconds = (performance.now() - this.startedAt) / 1000;
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || this.chunks[0]?.type || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        this.chunks = [];
        this.recorder = null;
        this.stopMeter();
        if (!keepOpen) this.release();
        resolve({ blob, mimeType, durationSeconds, peakLevel: this.peak });
      };
      recorder.stop();
    });
  }

  /** Discards the current recording. */
  cancel(keepOpen = false): void {
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.stop();
    }
    this.chunks = [];
    this.stopMeter();
    if (!keepOpen) this.release();
  }

  /** Turns the microphone off completely (the browser's recording indicator disappears). */
  release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.streamDeviceId = undefined;
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.analyser = null;
  }

  private async acquire(deviceId?: string): Promise<MediaStream> {
    const live = this.stream?.getAudioTracks().some((t) => t.readyState === 'live');
    if (this.stream && live && this.streamDeviceId === deviceId) return this.stream;
    this.release();
    const audio: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { ...audio, deviceId: { exact: deviceId } } : audio,
      });
    } catch (err) {
      // The saved microphone may have been unplugged: fall back to the default one.
      if (deviceId && err instanceof Error && ['OverconstrainedError', 'NotFoundError'].includes(err.name)) {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({ audio });
        } catch (inner) {
          throw toMicrophoneError(inner);
        }
      } else {
        throw toMicrophoneError(err);
      }
    }
    this.streamDeviceId = deviceId;
    return this.stream;
  }

  private startMeter(stream: MediaStream) {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) {
        this.peak = 1; // cannot measure, so never treat as silent
        return;
      }
      if (!this.audioContext) {
        this.audioContext = new Ctx();
        const source = this.audioContext.createMediaStreamSource(stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 1024;
        source.connect(this.analyser);
      }
      void this.audioContext.resume().catch(() => undefined);
      const analyser = this.analyser!;
      const buf = new Float32Array(analyser.fftSize);
      this.levelTimer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        const level = Math.min(1, Math.sqrt(rms) * 1.6);
        this.peak = Math.max(this.peak, level);
        this.onLevel?.(level);
      }, 60);
    } catch {
      this.peak = 1;
    }
  }

  private stopMeter() {
    if (this.levelTimer !== null) window.clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.onLevel?.(0);
  }
}

/** Lists microphones. Labels are only available after the user has granted permission once. */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
}
