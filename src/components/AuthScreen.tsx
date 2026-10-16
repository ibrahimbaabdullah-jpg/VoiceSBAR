import { useEffect, useState, type FormEvent } from 'react';
import type { SetupStatus } from '../../shared/api';
import { PASSWORD_MIN_LENGTH, USERNAME_HINT, USERNAME_PATTERN } from '../../shared/rules';
import { api } from '../api/client';
import { APP_TAGLINE, Brand } from './Brand';

type Mode = 'login' | 'register' | 'reset';

/** An invite link like https://site/#invite=WTC-XXXX-... pre-fills the code. */
function inviteFromUrl(): string {
  return /invite=([A-Za-z0-9-]+)/.exec(window.location.hash)?.[1] ?? '';
}

export function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [mode, setMode] = useState<Mode>(() => (inviteFromUrl() ? 'register' : 'login'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState(inviteFromUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .setupStatus()
      .then((s) => {
        setSetup(s);
        if (s.needsSetup) setMode('register');
      })
      .catch(() => undefined);
  }, []);

  const firstRun = setup?.needsSetup ?? false;

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setPassword('');
    setConfirm('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const name = username.trim();
    if (mode !== 'login') {
      if (mode === 'register' && !USERNAME_PATTERN.test(name)) return setError(`Username: ${USERNAME_HINT}`);
      if (password.length < PASSWORD_MIN_LENGTH) {
        return setError(`Choose a password with at least ${PASSWORD_MIN_LENGTH} characters.`);
      }
      if (password !== confirm) return setError('The two passwords do not match.');
      if (!code.trim()) return setError('Enter the code you were given.');
    }
    setBusy(true);
    try {
      if (mode === 'login') await api.login(name, password);
      else if (mode === 'register') await api.register(code.trim(), name, password);
      else await api.resetPassword(code.trim(), name, password);
      if (window.location.hash.includes('invite=')) window.history.replaceState(null, '', window.location.pathname);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const title = firstRun
    ? 'Set up your site'
    : mode === 'login'
      ? 'Sign in'
      : mode === 'register'
        ? 'Create your account'
        : 'Reset your password';

  return (
    <div className="center-screen">
      <form className="card narrow auth" onSubmit={submit} noValidate>
        <Brand size="big" />
        <p className="tagline-strong">{APP_TAGLINE}</p>
        <p className="muted tagline">Speak Arabic, English, or both. Get accurate text to paste anywhere.</p>
        <h1>{title}</h1>

        {firstRun && (
          <div className="notice info">
            {setup?.setupCodeConfigured ? (
              <>
                Welcome! Enter the <strong>admin setup code</strong> you saved as the <code>ADMIN_SETUP_CODE</code>{' '}
                secret in Cloudflare, then choose your admin username and password. This works only once.
              </>
            ) : (
              <>
                This site has no admin yet. Add a secret named <code>ADMIN_SETUP_CODE</code> in your Cloudflare Pages
                project settings, redeploy, then come back here. See <em>docs/DEPLOYMENT.md</em>.
              </>
            )}
          </div>
        )}

        {mode !== 'login' && (
          <label className="field">
            <span>{firstRun ? 'Admin setup code' : mode === 'register' ? 'Invite code' : 'Reset code'}</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={firstRun ? '' : mode === 'register' ? 'WTC-XXXX-XXXX-XXXX-XXXX' : 'RST-XXXX-XXXX-XXXX-XXXX'}
              required
            />
          </label>
        )}

        <div className="field">
          <label htmlFor="auth-username">Username</label>
          <input
            id="auth-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby={mode === 'register' ? 'auth-username-hint' : undefined}
            required
          />
          {mode === 'register' && (
            <small id="auth-username-hint" className="hint">
              {USERNAME_HINT}
            </small>
          )}
        </div>

        <div className="field">
          <label htmlFor="auth-password">{mode === 'login' ? 'Password' : 'New password'}</label>
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            aria-describedby={mode !== 'login' ? 'auth-password-hint' : undefined}
            required
          />
          {mode !== 'login' && (
            <small id="auth-password-hint" className="hint">
              At least {PASSWORD_MIN_LENGTH} characters.
            </small>
          )}
        </div>

        {mode !== 'login' && (
          <label className="field">
            <span>Repeat password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
        )}

        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}

        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Set new password'}
        </button>

        {!firstRun && (
          <div className="auth-links">
            {mode !== 'login' && (
              <button type="button" className="link" onClick={() => switchMode('login')}>
                I already have an account
              </button>
            )}
            {mode !== 'register' && (
              <button type="button" className="link" onClick={() => switchMode('register')}>
                I have an invite code
              </button>
            )}
            {mode !== 'reset' && (
              <button type="button" className="link" onClick={() => switchMode('reset')}>
                Forgot password? (ask your admin for a reset code)
              </button>
            )}
          </div>
        )}
        <p className="hint center">Accounts are by invitation only, to protect the site's transcription credits.</p>
      </form>
    </div>
  );
}
