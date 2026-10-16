import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { EnhancementResult, MeResponse, UsageSummary } from '../../shared/api';
import type { SbarLanguage } from '../../shared/sbar';
import { trRecorder } from '../../shared/sbarI18n';
import { api, ApiError } from '../api/client';
import { recordingSupported, SILENCE_THRESHOLD, type Recording } from '../audio/recorder';
import { useHotkey } from '../hooks/useHotkey';
import { useRecorder } from '../hooks/useRecorder';
import { copyText } from '../lib/clipboard';
import { formatClock, keyLabel, languageName } from '../lib/format';
import type { HistoryEntry } from '../lib/history';
import type { Settings } from '../lib/settings';
import { insertText, wordCount } from '../lib/text';
import { UsageMeter } from './UsageMeter';

interface Notice {
  kind: 'info' | 'success' | 'warn' | 'error';
  message: ReactNode;
  actions?: { label: string; onClick: () => void }[];
}

interface ResultInfo {
  languageCode: string | null;
  durationSeconds: number;
  keytermsUsed: number;
  enhancement: EnhancementResult;
}

/** Turns the panel into the capture stage of the Handoff tab (the SBAR notes field). */
export interface HandoffOptions {
  /** The Handoff tab's language; the recorder's own labels follow it (the Dictate tab stays English). */
  language: SbarLanguage;
  sectionLabel: string;
  editorId: string;
  label: string;
  placeholder: string;
  maxLength: number;
  /** Shown in place of the word and character counts. */
  meta: ReactNode;
  /** Shown beside the editor label, e.g. the Dictated/Typed chip. */
  chip?: ReactNode;
  /** Returns a message while recording is not allowed yet (no consent), otherwise null. */
  recordBlocked: () => string | null;
  onSource: (source: 'dictated' | 'typed') => void;
}

interface Props {
  me: MeResponse;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  text: string;
  setText: (value: string | ((prev: string) => string)) => void;
  vocabularyCount: number;
  onUsage: (usage: UsageSummary) => void;
  onTranscribed: (entry: Omit<HistoryEntry, 'id' | 'createdAt'>) => void;
  active: boolean;
  handoff?: HandoffOptions;
}

/** Releases shorter than this in hold-to-talk mode are treated as accidental taps. */
const MIN_HOLD_SECONDS = 0.4;

export function DictatePanel({
  me,
  settings,
  updateSettings,
  text,
  setText,
  vocabularyCount,
  onUsage,
  onTranscribed,
  active,
  handoff,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [result, setResult] = useState<ResultInfo | null>(null);
  const [undoText, setUndoText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);
  const supported = recordingSupported();
  const { features } = me;
  const language = handoff?.language ?? 'en';
  /** Recorder strings are English here and translated only for the Arabic Handoff tab. */
  const L = useCallback(
    (english: string, values?: Record<string, string | number>) => trRecorder(english, language, values),
    [language],
  );
  const useKeyterms = settings.useVocabulary && features.keytermsAvailable && vocabularyCount > 0;
  const wantEnhance = settings.enhance && features.enhancementAvailable;

  /** Puts new text into the editor (at the caret, at the end, or replacing) and returns the result. */
  const applyText = useCallback(
    (incoming: string): string => {
      // Read the live editor value: this runs after an await, when `text` may be stale.
      const current = editorRef.current?.value ?? '';
      setUndoText(current);
      let next: string;
      if (settings.insertMode === 'replace' || !current.trim()) {
        next = incoming;
        caretRef.current = incoming.length;
      } else {
        const res = insertText(current, incoming, caretRef.current);
        next = res.text;
        caretRef.current = res.caret;
      }
      setText(next);
      return next;
    },
    [setText, settings.insertMode],
  );

  const discardAction = useCallback(() => ({ label: L('Discard'), onClick: () => setNotice(null) }), [L]);
  // Retry buttons call the latest `send` through a ref (it cannot reference itself directly).
  const sendRef = useRef<(recording: Recording) => Promise<void>>(async () => undefined);
  const retryActions = useCallback(
    (recording: Recording) => [{ label: L('Retry'), onClick: () => void sendRef.current(recording) }, discardAction()],
    [discardAction, L],
  );

  const send = useCallback(
    async (recording: Recording) => {
      if (navigator.onLine === false) {
        setNotice({
          kind: 'error',
          message: L("You're offline. Your recording is kept — press Retry when you're back online."),
          actions: retryActions(recording),
        });
        return;
      }
      setBusy(true);
      setNotice(null);
      try {
        const res = await api.transcribe(recording.blob, {
          durationSeconds: recording.durationSeconds,
          language: settings.language,
          enhance: wantEnhance,
          keyterms: useKeyterms,
          removeFillers: settings.removeFillers,
        });
        onUsage(res.usage);
        setResult({
          languageCode: res.languageCode,
          durationSeconds: res.durationSeconds,
          keytermsUsed: res.keytermsUsed,
          enhancement: res.enhancement,
        });
        if (!res.text) {
          setNotice({ kind: 'info', message: L('No speech was recognized in that recording.') });
          return;
        }
        applyText(res.text);
        handoff?.onSource('dictated');
        onTranscribed({
          text: res.text,
          rawText: res.rawText,
          languageCode: res.languageCode,
          durationSeconds: res.durationSeconds,
          enhanced: res.enhancement.status === 'applied',
        });

        const enhanceNote =
          wantEnhance && res.enhancement.message && res.enhancement.status !== 'applied'
            ? ` ${res.enhancement.message}`
            : '';
        // Handoff notes are not copied: the finished report is what gets handed over.
        if (settings.autoCopy && !handoff) {
          // Copy just the new dictation, ready to paste into another app.
          const method = await copyText(res.text);
          setNotice(
            method === 'failed'
              ? { kind: 'info', message: `Done. Press “Copy text” to copy it.${enhanceNote}` }
              : { kind: 'success', message: `Done — the new text is on your clipboard. Paste it anywhere with Ctrl+V (⌘V on Mac).${enhanceNote}` },
          );
        } else {
          setNotice({ kind: enhanceNote ? 'warn' : 'success', message: `${L('Done.')}${enhanceNote}` });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : L('Transcription failed.');
        const keep = !(err instanceof ApiError && ['audio_invalid', 'audio_too_short', 'audio_unsupported'].includes(err.code));
        setNotice({
          kind: 'error',
          message: keep ? L("{message} Your recording is kept, so you don't need to speak again.", { message }) : message,
          actions: keep ? retryActions(recording) : undefined,
        });
      } finally {
        setBusy(false);
      }
    },
    [settings.language, settings.removeFillers, settings.autoCopy, wantEnhance, useKeyterms, applyText, onUsage, onTranscribed, retryActions, handoff, L],
  );

  useLayoutEffect(() => {
    sendRef.current = send;
  });

  const onFinished = useCallback(
    (recording: Recording, reason: 'stopped' | 'limit') => {
      if (settings.mode === 'hold' && reason === 'stopped' && recording.durationSeconds < MIN_HOLD_SECONDS) {
        setNotice({
          kind: 'info',
          message: settings.hotkey
            ? L('Keep holding the button (or {key}) while you speak, then let go.', { key: keyLabel(settings.hotkey) })
            : L('Keep holding the button while you speak, then let go.'),
        });
        return;
      }
      if (settings.skipSilence && recording.peakLevel < SILENCE_THRESHOLD) {
        setNotice({
          kind: 'warn',
          message: L("We didn't hear anything, so nothing was sent and no credits were used. Check that the right microphone is selected in Settings."),
          actions: [{ label: L('Send anyway'), onClick: () => void send(recording) }, discardAction()],
        });
        return;
      }
      if (reason === 'limit') {
        setNotice({ kind: 'info', message: L('You reached the maximum recording length, so the recording was sent automatically.') });
      }
      void send(recording);
    },
    [settings.mode, settings.hotkey, settings.skipSilence, send, discardAction, L],
  );

  const recorder = useRecorder({
    deviceId: settings.deviceId,
    keepMicOpen: settings.keepMicOpen,
    maxSeconds: features.maxRecordingSeconds,
    onFinished,
    onError: (err) => setNotice({ kind: 'error', message: L(err.message) }),
  });

  const recording = recorder.state === 'recording' || recorder.state === 'starting';
  const canRecord = supported && !busy && active;

  const press = () => {
    if (!canRecord && !recording) return;
    const blocked = recording ? null : handoff?.recordBlocked();
    if (blocked) {
      setNotice({ kind: 'warn', message: blocked });
      return;
    }
    if (settings.mode === 'toggle') {
      if (recording) recorder.stop();
      else void recorder.start();
    } else {
      setNotice(null);
      void recorder.start();
    }
  };
  const release = () => {
    if (settings.mode === 'hold') recorder.stop();
  };

  useHotkey({ code: settings.hotkey, enabled: active && supported, onPress: press, onRelease: release });

  // Escape discards the current recording.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        recorder.cancel();
        setNotice({ kind: 'info', message: L('Recording discarded. Nothing was sent.') });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recording, recorder, L]);

  const doCopy = async () => {
    if (!text) return;
    const method = await copyText(text);
    if (method === 'failed') {
      editorRef.current?.focus();
      editorRef.current?.select();
      setNotice({ kind: 'warn', message: 'Your browser blocked automatic copying. The text is selected — press Ctrl+C (⌘C on Mac) to copy it.' });
    } else {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  const doEnhance = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await api.enhance(text);
      onUsage(res.usage);
      if (res.enhancement.status === 'applied') {
        setUndoText(text);
        setText(res.text);
        setNotice({ kind: 'success', message: L('Punctuation and formatting improved. Use Undo to go back.') });
      } else if (res.enhancement.status === 'unchanged') {
        setNotice({ kind: 'info', message: L('The text already looks good — nothing was changed.') });
      } else {
        setNotice({ kind: 'warn', message: res.enhancement.message ?? L('AI clean-up was not applied.') });
      }
    } catch (err) {
      setNotice({ kind: 'error', message: err instanceof Error ? err.message : L('AI clean-up failed.') });
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    // A byte-order mark makes Arabic display correctly in Windows Notepad.
    const blob = new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dictation-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const holdHint = L(settings.mode === 'hold' ? 'Hold to talk' : recording ? 'Tap to stop' : 'Tap to start');
  const keyHint =
    settings.hotkey &&
    L(settings.mode === 'hold' ? 'or hold {key} on your keyboard' : 'or press {key} to start and stop', {
      key: keyLabel(settings.hotkey),
    });
  const statusText = recorder.state === 'starting'
    ? L('Starting microphone…')
    : recorder.state === 'recording'
      ? L('Listening… {elapsed} / {max}', {
          elapsed: formatClock(recorder.elapsed),
          max: formatClock(features.maxRecordingSeconds),
        })
      : recorder.state === 'stopping' || busy
        ? L('Transcribing…')
        : L('Ready');
  const recordLabel = L(
    recording
      ? settings.mode === 'hold'
        ? 'Recording — release to stop'
        : 'Recording — tap to stop'
      : settings.mode === 'hold'
        ? 'Record — hold to talk'
        : 'Record — tap to start',
  );

  return (
    <section className="dictate" aria-label={handoff ? handoff.sectionLabel : 'Dictation'}>
      {!supported && (
        <p className="notice error" role="alert">
          {L(
            window.isSecureContext
              ? 'This browser cannot record audio. Please use a recent Chrome, Edge, Firefox or Safari over https.'
              : 'This browser cannot record audio on an insecure (http) page. Please use a recent Chrome, Edge, Firefox or Safari over https.',
          )}
        </p>
      )}

      <div className="recorder card">
        <div className="quick-options">
          <label className="select-inline">
            <span>{L('Language')}</span>
            <select value={settings.language} onChange={(e) => updateSettings({ language: e.target.value as Settings['language'] })}>
              <option value="auto">{L('Auto (Arabic + English)')}</option>
              <option value="ar">{L('Mostly Arabic')}</option>
              <option value="en">{L('Mostly English')}</option>
            </select>
          </label>
          <div className="segmented" role="group" aria-label={L('Recording mode')}>
            <button
              type="button"
              className={settings.mode === 'hold' ? 'on' : ''}
              aria-pressed={settings.mode === 'hold'}
              onClick={() => updateSettings({ mode: 'hold' })}
              disabled={recording}
            >
              {L('Hold to talk')}
            </button>
            <button
              type="button"
              className={settings.mode === 'toggle' ? 'on' : ''}
              aria-pressed={settings.mode === 'toggle'}
              onClick={() => updateSettings({ mode: 'toggle' })}
              disabled={recording}
            >
              {L('Tap to toggle')}
            </button>
          </div>
        </div>

        <div className="record-area">
          <button
            type="button"
            className={`record-btn ${recording ? 'live' : ''} ${busy ? 'busy' : ''}`}
            style={{ ['--level' as string]: recorder.level.toFixed(3) }}
            aria-pressed={recording}
            aria-label={recordLabel}
            disabled={!supported || (busy && !recording)}
            onPointerDown={(e) => {
              if (settings.mode !== 'hold' || e.button !== 0) return;
              e.currentTarget.setPointerCapture?.(e.pointerId);
              press();
            }}
            onPointerUp={() => release()}
            onPointerCancel={() => release()}
            onClick={() => {
              if (settings.mode === 'toggle') press();
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="mic-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="44" height="44">
                <path
                  fill="currentColor"
                  d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
                />
              </svg>
            </span>
          </button>
          <div className="record-text">
            <div className={`status ${recording ? 'live' : ''}`} aria-live="polite">
              {recording && <span className="rec-dot" aria-hidden="true" />}
              {statusText}
            </div>
            <div className="hint">
              {recording ? (
                <>
                  {L(settings.mode === 'hold' ? 'Release to transcribe' : 'Tap again to transcribe')}
                  <span className="key-hint"> · {L('Esc to discard')}</span>
                </>
              ) : (
                <>
                  {holdHint}
                  {keyHint && <span className="key-hint">{language === 'ar' ? '، ' : ', '}{keyHint}</span>}
                </>
              )}
            </div>
            <div className="chips">
              {features.enhancementAvailable && (
                <label className="chip">
                  <input type="checkbox" checked={settings.enhance} onChange={(e) => updateSettings({ enhance: e.target.checked })} />
                  {L('AI clean-up')}
                </label>
              )}
              {features.keytermsAvailable && vocabularyCount > 0 && (
                <label className="chip" title={L('Adds an extra ElevenLabs charge (keyterm prompting). See the Vocabulary page.')}>
                  <input
                    type="checkbox"
                    checked={settings.useVocabulary}
                    onChange={(e) => updateSettings({ useVocabulary: e.target.checked })}
                  />
                  {L('My vocabulary ({count}) · extra cost', { count: vocabularyCount })}
                </label>
              )}
            </div>
          </div>
        </div>
      </div>

      {notice && (
        <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <div>{notice.message}</div>
          {notice.actions && (
            <div className="notice-actions">
              {notice.actions.map((a) => (
                <button key={a.label} type="button" className="btn small" onClick={a.onClick}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="editor-card card">
        <div className="editor-head">
          <span className="editor-title">
            <label htmlFor={handoff?.editorId ?? 'editor'} className="editor-label">
              {handoff ? handoff.label : 'Your text'}
            </label>
            {handoff?.chip}
          </span>
          <div className="segmented small" role="group" aria-label={L('Text direction')}>
            {(['auto', 'rtl', 'ltr'] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={settings.textDirection === d ? 'on' : ''}
                aria-pressed={settings.textDirection === d}
                onClick={() => updateSettings({ textDirection: d })}
                title={L(d === 'auto' ? 'Each paragraph follows its own language' : d === 'rtl' ? 'Right to left' : 'Left to right')}
              >
                {d === 'auto' ? L('Auto') : d.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <textarea
          id={handoff?.editorId ?? 'editor'}
          ref={editorRef}
          maxLength={handoff?.maxLength}
          className="editor"
          dir={settings.textDirection}
          value={text}
          placeholder={handoff ? handoff.placeholder : 'Your transcription appears here. You can edit it before copying.'}
          onChange={(e) => {
            setText(e.target.value);
            handoff?.onSource('typed');
            caretRef.current = e.target.selectionStart;
          }}
          onSelect={(e) => {
            caretRef.current = e.currentTarget.selectionEnd;
          }}
          spellCheck
        />
        <div className="editor-meta muted">
          {handoff ? (
            <span>{handoff.meta}</span>
          ) : (
            <span>
              {wordCount(text)} words · {text.length} characters
            </span>
          )}
          {result && (
            <span>
              {L('Last: {language} · {seconds} s', {
                language: L(languageName(result.languageCode)),
                seconds: result.durationSeconds.toFixed(1),
              })}
              {result.keytermsUsed > 0 ? ` · ${L('{count} vocabulary terms', { count: result.keytermsUsed })}` : ''}
              {result.enhancement.status === 'applied' ? ` · ${L('AI cleaned')}` : ''}
            </span>
          )}
        </div>
        <div className="toolbar">
          {!handoff && (
            <button type="button" className="btn primary big" onClick={() => void doCopy()} disabled={!text}>
              {copied ? '✓ Copied' : 'Copy text'}
            </button>
          )}
          {features.enhancementAvailable && (
            <button type="button" className="btn" onClick={() => void doEnhance()} disabled={!text.trim() || busy}>
              {L('Improve punctuation (AI)')}
            </button>
          )}
          {undoText !== null && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setText(undoText);
                setUndoText(null);
              }}
            >
              {L('Undo')}
            </button>
          )}
          {!handoff && (
            <>
              <button type="button" className="btn" onClick={download} disabled={!text}>
                Download .txt
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setUndoText(text);
                  setText('');
                  caretRef.current = null;
                }}
                disabled={!text}
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {!handoff && (
        <div className="card">
          <UsageMeter usage={me.usage} />
        </div>
      )}
    </section>
  );
}
