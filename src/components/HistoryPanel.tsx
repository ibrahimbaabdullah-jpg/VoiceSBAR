import { useMemo, useState } from 'react';
import { copyText } from '../lib/clipboard';
import { formatDate, languageName } from '../lib/format';
import { HISTORY_LIMIT, type useHistory } from '../lib/history';

interface Props {
  history: ReturnType<typeof useHistory>;
  enabled: boolean;
  onUse: (text: string) => void;
}

export function HistoryPanel({ history, enabled, onUse }: Props) {
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? history.entries.filter((e) => e.text.toLowerCase().includes(q)) : history.entries;
  }, [history.entries, query]);

  const copy = async (id: string, text: string) => {
    const method = await copyText(text);
    setCopiedId(method === 'failed' ? null : id);
    if (method !== 'failed') window.setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <section className="card" aria-label="History">
      <div className="section-head">
        <h2>History</h2>
        {history.entries.length > 0 &&
          (confirmClear ? (
            <span className="inline-confirm">
              Delete all {history.entries.length}?
              <button className="btn small danger" onClick={() => { history.clear(); setConfirmClear(false); }}>
                Delete all
              </button>
              <button className="btn small" onClick={() => setConfirmClear(false)}>Cancel</button>
            </span>
          ) : (
            <button className="btn small ghost" onClick={() => setConfirmClear(true)}>Clear history</button>
          ))}
      </div>
      <p className="hint">
        Stored only in this browser on this device (last {HISTORY_LIMIT}). The server never keeps your transcripts.
        {!enabled && ' Saving new history is turned off in Settings.'}
      </p>
      {history.entries.length > 0 && (
        <input
          className="search"
          type="search"
          placeholder="Search history…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search history"
        />
      )}
      {filtered.length === 0 ? (
        <p className="muted empty">{history.entries.length ? 'No matches.' : 'Nothing here yet. Your transcriptions will appear here.'}</p>
      ) : (
        <ul className="history-list">
          {filtered.map((e) => (
            <li key={e.id} className="history-item">
              <div className="history-meta muted">
                {formatDate(e.createdAt)} · {languageName(e.languageCode)} · {e.durationSeconds.toFixed(1)} s
                {e.enhanced ? ' · AI cleaned' : ''}
              </div>
              <p className="history-text" dir="auto">{e.text}</p>
              <div className="history-actions">
                <button className="btn small primary" onClick={() => void copy(e.id, e.text)}>
                  {copiedId === e.id ? '✓ Copied' : 'Copy'}
                </button>
                <button className="btn small" onClick={() => onUse(e.text)}>Add to editor</button>
                {e.enhanced && e.rawText !== e.text && (
                  <button className="btn small" onClick={() => void copy(`${e.id}-raw`, e.rawText)}>
                    {copiedId === `${e.id}-raw` ? '✓ Copied' : 'Copy original'}
                  </button>
                )}
                <button className="btn small ghost" onClick={() => history.remove(e.id)} aria-label="Delete this entry">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
