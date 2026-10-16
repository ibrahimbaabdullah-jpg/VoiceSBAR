import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MicrophoneError, Recorder, toMicrophoneError, type Recording } from '../audio/recorder';

export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping';

interface Options {
  deviceId: string;
  keepMicOpen: boolean;
  maxSeconds: number;
  /** Called with the finished recording (also when the time limit stops it). */
  onFinished: (recording: Recording, reason: 'stopped' | 'limit') => void;
  onError: (error: MicrophoneError) => void;
}

export function useRecorder({ deviceId, keepMicOpen, maxSeconds, onFinished, onError }: Options) {
  const recorderRef = useRef<Recorder | null>(null);
  const [state, setState] = useState<RecorderState>('idle');
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const stateRef = useRef<RecorderState>('idle');
  const stopRequested = useRef(false);
  const startedAt = useRef(0);
  const callbacks = useRef({ onFinished, onError });
  const optsRef = useRef({ deviceId, keepMicOpen, maxSeconds });
  useLayoutEffect(() => {
    callbacks.current = { onFinished, onError };
    optsRef.current = { deviceId, keepMicOpen, maxSeconds };
  });

  const setBoth = (s: RecorderState) => {
    stateRef.current = s;
    setState(s);
  };

  const getRecorder = () => {
    recorderRef.current ??= new Recorder();
    return recorderRef.current;
  };

  const finish = useCallback(async (reason: 'stopped' | 'limit') => {
    if (stateRef.current !== 'recording') return;
    setBoth('stopping');
    const recording = await getRecorder().stop(optsRef.current.keepMicOpen);
    setBoth('idle');
    setElapsed(0);
    if (recording) callbacks.current.onFinished(recording, reason);
  }, []);

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle') return;
    stopRequested.current = false;
    setBoth('starting');
    try {
      await getRecorder().start({ deviceId: optsRef.current.deviceId || undefined, onLevel: setLevel });
    } catch (err) {
      setBoth('idle');
      callbacks.current.onError(toMicrophoneError(err));
      return;
    }
    startedAt.current = performance.now();
    setElapsed(0);
    setBoth('recording');
    // The key or button may have been released while the microphone was still starting.
    if (stopRequested.current) void finish('stopped');
  }, [finish]);

  const stop = useCallback(() => {
    if (stateRef.current === 'starting') {
      stopRequested.current = true;
      return;
    }
    void finish('stopped');
  }, [finish]);

  const cancel = useCallback(() => {
    stopRequested.current = false;
    getRecorder().cancel(optsRef.current.keepMicOpen);
    setBoth('idle');
    setElapsed(0);
  }, []);

  // Elapsed-time display and the automatic stop at the maximum length.
  useEffect(() => {
    if (state !== 'recording') return;
    const timer = window.setInterval(() => {
      const secs = (performance.now() - startedAt.current) / 1000;
      setElapsed(secs);
      if (secs >= optsRef.current.maxSeconds) void finish('limit');
    }, 200);
    return () => window.clearInterval(timer);
  }, [state, finish]);

  // Release the microphone when the setting is turned off, the device changes, or on unmount.
  useEffect(() => {
    if (!keepMicOpen && stateRef.current === 'idle') recorderRef.current?.release();
  }, [keepMicOpen, deviceId]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && stateRef.current === 'idle') recorderRef.current?.release();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      recorderRef.current?.cancel(false);
    };
  }, []);

  return { state, level, elapsed, start, stop, cancel };
}
