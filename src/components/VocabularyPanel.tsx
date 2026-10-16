import { useEffect, useMemo, useState } from 'react';
import type { Features } from '../../shared/api';
import { checkKeytermList, KEYTERM_MAX_COUNT, KEYTERM_MAX_WORDS } from '../../shared/rules';
import { api } from '../api/client';

interface Props {
  features: Features;
  onSaved: (terms: string[]) => void;
}

export function VocabularyPanel({ features, onSaved }: Props) {
  const [saved, setSaved] = useState<string[] | null>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    api
      .getVocabulary()
      .then((v) => {
        setSaved(v.terms);
        setDraft(v.terms.join('\n'));
      })
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  const check = useMemo(() => checkKeytermList(draft.split('\n')), [draft]);
  const dirty = saved !== null && check.terms.join('\n') !== saved.join('\n');
  const { audioPerHourUsd, keytermsPerHourUsd } = features.pricing;
  const surchargePct = audioPerHourUsd > 0 ? Math.round((keytermsPerHourUsd / audioPerHourUsd) * 100) : 0;

  const save = async () => {
    if (check.errors.length) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await api.saveVocabulary(check.terms);
      setSaved(res.terms);
      setDraft(res.terms.join('\n'));
      onSaved(res.terms);
      setStatus({ kind: 'success', message: `Saved ${res.terms.length} term${res.terms.length === 1 ? '' : 's'}.` });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card" aria-label="Vocabulary">
      <h2>My vocabulary</h2>
      <p>
        Add words that speech recognition might get wrong: drug names, diseases, gene names, people, places, course
        codes, or technical terms in English or Arabic. They are sent to ElevenLabs as <em>keyterms</em> to improve
        recognition. One term per line, at most {KEYTERM_MAX_WORDS} words each.
      </p>
      <div className="notice warn">
        <strong>Extra cost:</strong> when your vocabulary is used, ElevenLabs charges an additional keyterm fee
        {keytermsPerHourUsd > 0 && audioPerHourUsd > 0
          ? ` (about $${keytermsPerHourUsd.toFixed(2)} per audio hour on top of $${audioPerHourUsd.toFixed(2)}, roughly +${surchargePct}%)`
          : ''}
        . It counts against the site's budget, not your minutes. You can switch vocabulary off at any time on the
        Dictate page or in Settings.
        {!features.keytermsAvailable && ' Vocabulary is currently disabled by the site admin.'}
      </div>
      {loadError ? (
        <p className="notice error">{loadError}</p>
      ) : saved === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <label className="field">
            <span>
              Terms ({check.terms.length}/{KEYTERM_MAX_COUNT})
            </span>
            <textarea
              className="vocab-input"
              dir="auto"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setStatus(null);
              }}
              placeholder={'amlodipine\nHbA1c\nKaplan-Meier\nاحتشاء عضلة القلب'}
              rows={10}
              spellCheck={false}
            />
          </label>
          {check.errors.length > 0 && (
            <ul className="notice error error-list" role="alert">
              {check.errors.map((e) => (
                <li key={e.term}>
                  <bdi>{e.term}</bdi>: {e.error}
                </li>
              ))}
            </ul>
          )}
          {status && <p className={`notice ${status.kind}`}>{status.message}</p>}
          <div className="toolbar">
            <button className="btn primary" onClick={() => void save()} disabled={!dirty || saving || check.errors.length > 0}>
              {saving ? 'Saving…' : 'Save vocabulary'}
            </button>
            {dirty && (
              <button className="btn ghost" onClick={() => setDraft(saved.join('\n'))}>
                Discard changes
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
