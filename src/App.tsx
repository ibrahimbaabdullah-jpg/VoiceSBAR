import { useCallback, useEffect, useState } from 'react';
import type { MeResponse, UsageSummary } from '../shared/api';
import { api, ApiError, onUnauthorized } from './api/client';
import { AdminPanel } from './components/AdminPanel';
import { AuthScreen } from './components/AuthScreen';
import { Brand } from './components/Brand';
import { DictatePanel } from './components/DictatePanel';
import { HistoryPanel } from './components/HistoryPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { UsageMeter } from './components/UsageMeter';
import { VocabularyPanel } from './components/VocabularyPanel';
import { clearStoredHistory, useHistory } from './lib/history';
import { useSettings } from './lib/settings';

type Tab = 'dictate' | 'history' | 'vocabulary' | 'settings' | 'admin';
const TABS: { id: Tab; label: string; adminOnly?: boolean }[] = [
  { id: 'dictate', label: 'Dictate' },
  { id: 'history', label: 'History' },
  { id: 'vocabulary', label: 'Vocabulary' },
  { id: 'settings', label: 'Settings' },
  { id: 'admin', label: 'Admin', adminOnly: true },
];

function tabFromHash(): Tab {
  const id = window.location.hash.replace(/^#\/?/, '');
  return (TABS.find((t) => t.id === id)?.id ?? 'dictate') as Tab;
}

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'signed-out' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');

  const load = useCallback(
    () =>
      api.me().then(
        (data) => {
          setMe(data);
          setStatus('ready');
        },
        (err: unknown) => {
          if (err instanceof ApiError && err.status === 401) {
            setMe(null);
            setStatus('signed-out');
          } else {
            setLoadError(err instanceof Error ? err.message : 'Could not load the app.');
            setStatus('error');
          }
        },
      ),
    [],
  );

  useEffect(() => {
    void load();
    return onUnauthorized(() => {
      setMe(null);
      setStatus('signed-out');
    });
  }, [load]);

  if (status === 'loading') {
    return (
      <div className="center-screen" aria-busy="true">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <Brand size="big" />
          <p className="notice error" role="alert">{loadError}</p>
          <button className="btn primary" onClick={() => void load()}>Try again</button>
        </div>
      </div>
    );
  }
  if (status === 'signed-out' || !me) {
    return <AuthScreen onSignedIn={() => void load()} />;
  }
  return (
    <SignedInApp
      me={me}
      onUsage={(usage) => setMe((m) => (m ? { ...m, usage } : m))}
      onSignedOut={() => {
        setMe(null);
        setStatus('signed-out');
      }}
    />
  );
}

function SignedInApp({
  me,
  onUsage,
  onSignedOut,
}: {
  me: MeResponse;
  onUsage: (u: UsageSummary) => void;
  onSignedOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [settings, updateSettings] = useSettings();
  const history = useHistory(me.user.username);
  const [editorText, setEditorText] = useState('');
  const [vocabularyCount, setVocabularyCount] = useState(0);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    api
      .getVocabulary()
      .then((v) => setVocabularyCount(v.terms.length))
      .catch(() => undefined);
  }, []);

  const go = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, '', t === 'dictate' ? window.location.pathname : `#/${t}`);
  };

  const signOut = async (clearHistory: boolean, everywhere = false) => {
    try {
      await (everywhere ? api.logoutAll() : api.logout());
    } catch {
      // Even if the server is unreachable, forget the session locally.
    }
    if (clearHistory) clearStoredHistory(me.user.username);
    onSignedOut();
  };

  const visibleTabs = TABS.filter((t) => !t.adminOnly || me.user.role === 'admin');

  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <UsageMeter usage={me.usage} compact />
      </header>
      <nav className="tabs" aria-label="Sections">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => go(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="content">
        {/* The dictation panel stays mounted so text and recordings survive switching tabs. */}
        <div hidden={tab !== 'dictate'}>
          <DictatePanel
            me={me}
            settings={settings}
            updateSettings={updateSettings}
            text={editorText}
            setText={setEditorText}
            vocabularyCount={vocabularyCount}
            onUsage={onUsage}
            onTranscribed={(entry) => settings.saveHistory && history.add(entry)}
            active={tab === 'dictate'}
          />
        </div>
        {tab === 'history' && (
          <HistoryPanel
            history={history}
            enabled={settings.saveHistory}
            onUse={(text) => {
              setEditorText((current) => (current.trim() ? `${current.trimEnd()}\n\n${text}` : text));
              go('dictate');
            }}
          />
        )}
        {tab === 'vocabulary' && (
          <VocabularyPanel features={me.features} onSaved={(terms) => setVocabularyCount(terms.length)} />
        )}
        {tab === 'settings' && (
          <SettingsPanel
            me={me}
            settings={settings}
            updateSettings={updateSettings}
            onSignOut={signOut}
          />
        )}
        {tab === 'admin' && me.user.role === 'admin' && <AdminPanel currentUserId={me.user.id} />}
      </main>
      <footer className="footer muted">
        Speech-to-text by ElevenLabs Scribe. Recordings are sent for transcription and are not stored by this
        site. <a href="https://github.com/ibrahimbaabdullah-jpg/WhisperToCursor" target="_blank" rel="noreferrer">Open source (MIT)</a>
      </footer>
    </div>
  );
}
