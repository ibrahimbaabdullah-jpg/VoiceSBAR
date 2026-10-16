import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { MeResponse } from '../../shared/api';
import { PASSWORD_MIN_LENGTH } from '../../shared/rules';
import { api } from '../api/client';
import { listMicrophones, Recorder, toMicrophoneError } from '../audio/recorder';
import { isTypingKey } from '../hooks/useHotkey';
import { keyLabel } from '../lib/format';
import type { Settings } from '../lib/settings';

interface Props {
  me: MeResponse;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  onSignOut: (clearHistory: boolean, everywhere?: boolean) => Promise<void>;
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{label}</strong>
        {hint && <small className="hint">{hint}</small>}
      </span>
    </label>
  );
}

export function SettingsPanel({ me, settings, updateSettings, onSignOut }: Props) {
  return (
    <div className="stack">
      <RecordingSettings settings={settings} updateSettings={updateSettings} />

      <section className="card">
        <h2>Transcription</h2>
        <label className="field">
          <span>Language</span>
          <select value={settings.language} onChange={(e) => updateSettings({ language: e.target.value as Settings['language'] })}>
            <option value="auto">Automatic — Arabic, English, or both mixed (recommended)</option>
            <option value="ar">Mostly Arabic</option>
            <option value="en">Mostly English</option>
          </select>
          <small className="hint">
            Speech is never translated: Arabic stays in Arabic script and English terms stay in English.
          </small>
        </label>
        <Toggle
          checked={settings.removeFillers}
          onChange={(v) => updateSettings({ removeFillers: v })}
          label="Remove filler words"
          hint="Leaves out “um”, “uh”, false starts and background sounds."
        />
        <Toggle
          checked={settings.useVocabulary}
          onChange={(v) => updateSettings({ useVocabulary: v })}
          disabled={!me.features.keytermsAvailable}
          label="Use my vocabulary"
          hint={
            me.features.keytermsAvailable
              ? 'Improves recognition of your terms. Adds an ElevenLabs keyterm charge on each recording.'
              : 'Disabled by the site admin.'
          }
        />
        <Toggle
          checked={settings.enhance}
          onChange={(v) => updateSettings({ enhance: v })}
          disabled={!me.features.enhancementAvailable}
          label="AI clean-up of punctuation and capitalization"
          hint={
            me.features.enhancementAvailable
              ? 'An AI model fixes punctuation, capitals and paragraphs only. If it changes any word, number or term, the original transcript is kept automatically.'
              : 'Not available on this site or for your account.'
          }
        />
      </section>

      <section className="card">
        <h2>Text</h2>
        <Toggle
          checked={settings.autoCopy}
          onChange={(v) => updateSettings({ autoCopy: v })}
          label="Copy new text to the clipboard automatically"
          hint="Some browsers (especially Safari) block this; use the Copy button then."
        />
        <fieldset className="radio-group">
          <legend>When new text arrives</legend>
          <label>
            <input
              type="radio"
              checked={settings.insertMode === 'append'}
              onChange={() => updateSettings({ insertMode: 'append' })}
            />
            Add it at the cursor (or the end)
          </label>
          <label>
            <input
              type="radio"
              checked={settings.insertMode === 'replace'}
              onChange={() => updateSettings({ insertMode: 'replace' })}
            />
            Replace the text in the editor
          </label>
        </fieldset>
      </section>

      <section className="card">
        <h2>Privacy</h2>
        <Toggle
          checked={settings.saveHistory}
          onChange={(v) => updateSettings({ saveHistory: v })}
          label="Keep a history on this device"
          hint="Transcripts are stored only in this browser. Audio is never stored anywhere by this site."
        />
      </section>

      <AccountSettings me={me} onSignOut={onSignOut} />
    </div>
  );
}

function RecordingSettings({ settings, updateSettings }: Pick<Props, 'settings' | 'updateSettings'>) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [testLevel, setTestLevel] = useState<number | null>(null);
  const [testError, setTestError] = useState('');
  const testRecorder = useRef<Recorder | null>(null);

  const refreshMics = useCallback(() => {
    listMicrophones()
      .then(setMics)
      .catch(() => setMics([]));
  }, []);

  useEffect(() => {
    refreshMics();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshMics);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshMics);
      testRecorder.current?.cancel();
    };
  }, [refreshMics]);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape' && e.code) updateSettings({ hotkey: e.code });
      setCapturing(false);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capturing, updateSettings]);

  const testMic = async () => {
    setTestError('');
    const r = new Recorder();
    testRecorder.current = r;
    try {
      await r.start({ deviceId: settings.deviceId || undefined, onLevel: setTestLevel });
      refreshMics(); // labels become visible after permission is granted
      window.setTimeout(() => {
        r.cancel();
        setTestLevel(null);
      }, 5000);
    } catch (err) {
      setTestLevel(null);
      setTestError(toMicrophoneError(err).message);
    }
  };

  const labelsHidden = mics.length > 0 && mics.every((m) => !m.label);

  return (
    <section className="card">
      <h2>Recording</h2>
      <fieldset className="radio-group">
        <legend>Recording mode</legend>
        <label>
          <input type="radio" checked={settings.mode === 'hold'} onChange={() => updateSettings({ mode: 'hold' })} />
          Hold to talk — hold the button or key while speaking, release to transcribe
        </label>
        <label>
          <input type="radio" checked={settings.mode === 'toggle'} onChange={() => updateSettings({ mode: 'toggle' })} />
          Tap to toggle — press once to start, again to stop
        </label>
      </fieldset>

      <div className="field">
        <span>Keyboard shortcut (works while this page is open and focused)</span>
        <div className="row">
          <kbd className="kbd">{settings.hotkey ? keyLabel(settings.hotkey) : 'Off'}</kbd>
          <button className="btn small" onClick={() => setCapturing(true)} disabled={capturing}>
            {capturing ? 'Press any key… (Esc to cancel)' : 'Change'}
          </button>
          {settings.hotkey && (
            <button className="btn small ghost" onClick={() => updateSettings({ hotkey: '' })}>
              Turn off
            </button>
          )}
        </div>
        <small className="hint">
          {settings.hotkey && isTypingKey(settings.hotkey)
            ? `${keyLabel(settings.hotkey)} is ignored while you type in a text box. Pick an F-key (e.g. F2) to use it everywhere on the page.`
            : 'Websites cannot see keys pressed in other apps, so switch back to this tab to dictate.'}
        </small>
      </div>

      <div className="field">
        <label htmlFor="mic-select">Microphone</label>
        <div className="row">
          <select id="mic-select" value={settings.deviceId} onChange={(e) => updateSettings({ deviceId: e.target.value })}>
            <option value="">System default</option>
            {mics.map((m, i) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
          <button className="btn small" type="button" onClick={() => void testMic()} disabled={testLevel !== null}>
            {testLevel !== null ? 'Listening…' : 'Test'}
          </button>
        </div>
        {testLevel !== null && (
          <div className="meter ok live-meter" aria-label="Microphone level">
            <div style={{ width: `${Math.round(testLevel * 100)}%` }} />
          </div>
        )}
        {testError && <p className="notice error">{testError}</p>}
        {labelsHidden && <small className="hint">Press Test once to allow the microphone and see device names.</small>}
      </div>

      <Toggle
        checked={settings.skipSilence}
        onChange={(v) => updateSettings({ skipSilence: v })}
        label="Don't send silent recordings"
        hint="Saves credits when the microphone picked up nothing. You can still choose “Send anyway”."
      />
      <Toggle
        checked={settings.keepMicOpen}
        onChange={(v) => updateSettings({ keepMicOpen: v })}
        label="Keep the microphone ready between recordings"
        hint="Starts faster so your first word isn't cut off. Your browser will show the microphone as in use while this page is open. Nothing is recorded or sent until you press the button."
      />
    </section>
  );
}

function AccountSettings({ me, onSignOut }: Pick<Props, 'me' | 'onSignOut'>) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const change = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    if (next.length < PASSWORD_MIN_LENGTH) {
      return setStatus({ kind: 'error', message: `Use at least ${PASSWORD_MIN_LENGTH} characters.` });
    }
    if (next !== repeat) return setStatus({ kind: 'error', message: 'The new passwords do not match.' });
    setBusy(true);
    try {
      await api.changePassword(me.user.username, current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
      setStatus({ kind: 'success', message: 'Password changed. Other devices have been signed out.' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not change the password.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Account</h2>
      <p>
        Signed in as <strong>{me.user.username}</strong>
        {me.user.role === 'admin' ? ' (admin)' : ''}.
      </p>
      <form onSubmit={change} className="password-form">
        <h3>Change password</h3>
        <input type="text" autoComplete="username" value={me.user.username} readOnly hidden />
        <label className="field">
          <span>Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="field">
          <span>Repeat new password</span>
          <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </label>
        {status && <p className={`notice ${status.kind}`}>{status.message}</p>}
        <button className="btn" type="submit" disabled={busy || !current || !next}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
      <div className="toolbar">
        <button className="btn" onClick={() => void onSignOut(false)}>Sign out</button>
        <button className="btn" onClick={() => void onSignOut(true)}>Sign out and clear this device's history</button>
        <button className="btn ghost" onClick={() => void onSignOut(false, true)}>Sign out on all devices</button>
      </div>
    </section>
  );
}
