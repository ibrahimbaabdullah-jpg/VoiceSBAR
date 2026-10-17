import { useEffect, useState, type FormEvent } from 'react';
import type { SetupStatus } from '../../shared/api';
import { PASSWORD_MIN_LENGTH, USERNAME_HINT, USERNAME_PATTERN } from '../../shared/rules';
import { api } from '../api/client';
import { AuthShowcase } from './AuthShowcase';
import { APP_NAME, Brand } from './Brand';

type Mode = 'login' | 'register' | 'reset';

/** An invite link like https://site/#invite=WTC-XXXX-... pre-fills the code. */
function inviteFromUrl(): string {
  return /invite=([A-Za-z0-9-]+)/.exec(window.location.hash)?.[1] ?? '';
}

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="15" r="4" />
      <path d="M10.8 12.2L20 3" />
      <path d="M16 7l3 3" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
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
  const [showPassword, setShowPassword] = useState(false);

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

  const subtitle = firstRun
    ? ''
    : mode === 'login'
      ? 'Welcome back. Sign in to start your next handover.'
      : mode === 'register'
        ? 'Use the invite code you were given.'
        : 'Ask your admin for a reset code.';

  return (
    <div className="auth-page">
      <div className="auth-rings" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <header className="auth-top">
        <Brand tag={false} />
      </header>

      <main className="auth-main">
        <AuthShowcase
          intro={
            <div className="auth-intro">
              <span className="auth-eyebrow">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
                </svg>
                AI-powered SBAR documentation
              </span>
              <h2 className="auth-headline">
                Turn spoken notes into clear, structured <span>SBAR reports.</span>
              </h2>
              <p className="auth-lead">
                Speak your handover in Arabic, English or both. {APP_NAME} writes it up and you paste it into any
                record.
              </p>
            </div>
          }
        />

        <section className="auth-panel">
          <form className="auth-form" onSubmit={submit} noValidate>
            <div className="auth-form-head">
              <h1>{title}</h1>
              {subtitle && <p className="muted">{subtitle}</p>}
            </div>

            {firstRun && (
              <div className="notice info">
                {setup?.setupCodeConfigured ? (
                  <>
                    Welcome! Enter the <strong>admin setup code</strong> you saved as the <code>ADMIN_SETUP_CODE</code>{' '}
                    secret in Cloudflare, then choose your admin username and password. This works only once.
                  </>
                ) : (
                  <>
                    This site has no admin yet. Add a secret named <code>ADMIN_SETUP_CODE</code> in your Cloudflare
                    Pages project settings, redeploy, then come back here. See <em>docs/DEPLOYMENT.md</em>.
                  </>
                )}
              </div>
            )}

            {mode !== 'login' && (
              <label className="field">
                <span>{firstRun ? 'Admin setup code' : mode === 'register' ? 'Invite code' : 'Reset code'}</span>
                <span className="auth-input">
                  <KeyIcon />
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder={firstRun ? '' : mode === 'register' ? 'WTC-XXXX-XXXX-XXXX-XXXX' : 'RST-XXXX-XXXX-XXXX-XXXX'}
                    required
                  />
                </span>
              </label>
            )}

            <div className="field">
              <label htmlFor="auth-username">Username</label>
              <span className="auth-input">
                <UserIcon />
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
              </span>
              {mode === 'register' && (
                <small id="auth-username-hint" className="hint">
                  {USERNAME_HINT}
                </small>
              )}
            </div>

            <div className="field">
              <div className="auth-label-row">
                <label htmlFor="auth-password">{mode === 'login' ? 'Password' : 'New password'}</label>
                {mode === 'login' && !firstRun && (
                  <button type="button" className="link auth-forgot" onClick={() => switchMode('reset')}>
                    Forgot password?
                  </button>
                )}
              </div>
              <span className="auth-input">
                <LockIcon />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  aria-describedby={mode !== 'login' ? 'auth-password-hint' : undefined}
                  required
                />
                <button
                  type="button"
                  className="auth-eye"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </span>
              {mode !== 'login' && (
                <small id="auth-password-hint" className="hint">
                  At least {PASSWORD_MIN_LENGTH} characters.
                </small>
              )}
            </div>

            {mode !== 'login' && (
              <label className="field">
                <span>Repeat password</span>
                <span className="auth-input">
                  <LockIcon />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </span>
              </label>
            )}

            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}

            <button className="btn primary block auth-submit" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Set new password'}
              {!busy && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14" />
                  <path d="M13 6l6 6-6 6" />
                </svg>
              )}
            </button>

            {!firstRun && (
              <>
                <div className="auth-divider">
                  <span>{mode === 'login' ? `New to ${APP_NAME}?` : 'Or'}</span>
                </div>
                <div className="auth-links">
                  {mode !== 'login' && (
                    <button type="button" className="btn block auth-secondary" onClick={() => switchMode('login')}>
                      I already have an account
                    </button>
                  )}
                  {mode !== 'register' && (
                    <button type="button" className="btn block auth-secondary" onClick={() => switchMode('register')}>
                      I have an invite code
                    </button>
                  )}
                </div>
              </>
            )}
            <p className="hint center">Accounts are by invitation only, to protect the site's transcription credits.</p>

            <div className="auth-note">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              <p>
                <strong>Fictional cases only.</strong> Nothing is stored on the server: no audio, no notes and no
                reports.
              </p>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
