import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AdminInviteRow, AdminOverview, AdminUserRow, CreatedCode } from '../../shared/api';
import { api } from '../api/client';
import { copyText } from '../lib/clipboard';
import { formatDay, formatMinutes } from '../lib/format';

function parseMinutes(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function CodeBox({ title, created, onClose }: { title: string; created: CreatedCode; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/#invite=${created.code}`;
  const isInvite = created.code.startsWith('WTC-');
  const copy = async (text: string) => {
    if ((await copyText(text)) !== 'failed') {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className="notice success code-box" role="status">
      <strong>{title}</strong>
      <code className="code" dir="ltr">{created.code}</code>
      <p className="hint">
        Shown only once. It works one time and expires on {formatDay(created.expiresAt)}. Send it privately.
        {isInvite ? ' The person opens the site, chooses “I have an invite code” and picks a username and password.' : ' The person opens the site, chooses “Forgot password?” and enters their username, this code and a new password.'}
      </p>
      <div className="toolbar">
        <button className="btn small primary" onClick={() => void copy(created.code)}>{copied ? '✓ Copied' : 'Copy code'}</button>
        {isInvite && (
          <button className="btn small" onClick={() => void copy(link)}>Copy invite link</button>
        )}
        <button className="btn small ghost" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export function AdminPanel({ currentUserId }: { currentUserId: number }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [invites, setInvites] = useState<AdminInviteRow[]>([]);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ title: string; code: CreatedCode } | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);

  const reload = useCallback(
    () =>
      Promise.all([api.admin.overview(), api.admin.users(), api.admin.invites()]).then(
        ([o, u, i]) => {
          setOverview(o);
          setUsers(u.users);
          setInvites(i.invites);
          setLoadedAt(Date.now() / 1000);
          setError('');
        },
        (err: unknown) => setError(err instanceof Error ? err.message : 'Could not load admin data.'),
      ),
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    }
  };

  return (
    <div className="stack">
      {error && <p className="notice error" role="alert">{error}</p>}
      {overview && <Overview o={overview} />}
      {created && <CodeBox title={created.title} created={created.code} onClose={() => setCreated(null)} />}
      <InviteForm
        onCreated={async (code) => {
          setCreated({ title: 'Invite code created', code });
          await reload();
        }}
        onError={setError}
      />
      <section className="card">
        <h2>People ({users.length})</h2>
        <ul className="user-list">
          {users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isSelf={u.id === currentUserId}
              onUpdate={(patch) => run(() => api.admin.updateUser(u.id, patch))}
              onDelete={() => run(() => api.admin.deleteUser(u.id))}
              onResetCode={() =>
                run(async () => setCreated({ title: `Password reset code for ${u.username}`, code: await api.admin.resetCode(u.id) }))
              }
            />
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Codes</h2>
        {invites.length === 0 ? (
          <p className="muted">No codes yet.</p>
        ) : (
          <ul className="invite-list">
            {invites.map((i) => {
              const now = loadedAt;
              const state = i.usedAt ? `used by ${i.usedByUsername ?? 'a deleted user'}` : i.expiresAt < now ? 'expired' : `active until ${formatDay(i.expiresAt)}`;
              return (
                <li key={i.id} className="invite-item">
                  <div>
                    <strong>{i.kind === 'reset' ? `Password reset for ${i.targetUsername ?? '?'}` : `Invite (${i.role})`}</strong>
                    {i.note && <span className="muted"> · {i.note}</span>}
                    <div className="muted small-text">
                      Created {formatDay(i.createdAt)} · {state}
                    </div>
                  </div>
                  {!i.usedAt && i.expiresAt >= now && (
                    <button className="btn small ghost" onClick={() => void run(() => api.admin.deleteInvite(i.id))}>
                      Revoke
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Overview({ o }: { o: AdminOverview }) {
  return (
    <section className="card">
      <h2>Overview</h2>
      {!o.providers.elevenlabsConfigured && (
        <p className="notice error">
          ElevenLabs is not configured. Add the <code>ELEVENLABS_API_KEY</code> secret in Cloudflare and redeploy.
        </p>
      )}
      <div className="stats">
        <div className="stat">
          <span className="stat-value">{formatMinutes(o.dayAudioSeconds)}</span>
          <span className="stat-label">minutes today (site cap {formatMinutes(o.globalDailyLimitSeconds)})</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatMinutes(o.monthAudioSeconds)}</span>
          <span className="stat-label">minutes this month (cap {formatMinutes(o.globalMonthlyLimitSeconds)})</span>
        </div>
        <div className="stat">
          <span className="stat-value">${o.estimatedMonthCostUsd.toFixed(2)}</span>
          <span className="stat-label">estimated ElevenLabs cost this month</span>
        </div>
        <div className="stat">
          <span className="stat-value">{o.dayRequests}</span>
          <span className="stat-label">recordings today ({o.dayErrors} failed)</span>
        </div>
      </div>
      <p className="hint">
        AI clean-up: {o.providers.enhancementConfigured ? `on (${o.providers.enhanceModel}), ${o.monthEnhanceRequests} requests this month` : 'not configured'} ·
        Vocabulary minutes this month: {formatMinutes(o.monthKeytermSeconds)} · Period {o.month} ({o.timeZone}). The
        estimate uses the prices in <code>wrangler.toml</code>; your ElevenLabs dashboard is authoritative.
      </p>
    </section>
  );
}

function InviteForm({ onCreated, onError }: { onCreated: (c: CreatedCode) => Promise<void>; onError: (m: string) => void }) {
  const [note, setNote] = useState('');
  const [daily, setDaily] = useState('');
  const [monthly, setMonthly] = useState('');
  const [days, setDays] = useState('7');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const code = await api.admin.createInvite({
        role,
        note: note.trim() || undefined,
        dailyLimitMinutes: parseMinutes(daily),
        monthlyLimitMinutes: parseMinutes(monthly),
        expiresInDays: Math.min(30, Math.max(1, Number(days) || 7)),
      });
      setNote('');
      await onCreated(code);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create the invite.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>Invite someone</h2>
      <div className="grid-2">
        <label className="field">
          <span>Note (who is it for?)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Dr. Sara" />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
            <option value="user">User</option>
            <option value="admin">Admin (can invite and manage people)</option>
          </select>
        </label>
        <label className="field">
          <span>Daily limit (minutes)</span>
          <input inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="site default" />
        </label>
        <label className="field">
          <span>Monthly limit (minutes)</span>
          <input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="site default" />
        </label>
        <label className="field">
          <span>Code expires after (days)</span>
          <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
      </div>
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create invite code'}
      </button>
    </form>
  );
}

function UserRow({
  user,
  isSelf,
  onUpdate,
  onDelete,
  onResetCode,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onUpdate: (patch: Parameters<typeof api.admin.updateUser>[1]) => Promise<void>;
  onDelete: () => Promise<void>;
  onResetCode: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [daily, setDaily] = useState('');
  const [monthly, setMonthly] = useState('');

  const startEdit = () => {
    setDaily(user.customDailyLimit ? String(user.dailyLimitSeconds / 60) : '');
    setMonthly(user.customMonthlyLimit ? String(user.monthlyLimitSeconds / 60) : '');
    setEditing(true);
  };

  return (
    <li className={`user-item ${user.disabled ? 'disabled' : ''}`}>
      <div className="user-main">
        <div>
          <strong>{user.username}</strong>
          {user.role === 'admin' && <span className="badge">admin</span>}
          {user.disabled && <span className="badge danger">disabled</span>}
          {!user.enhanceAllowed && <span className="badge muted-badge">AI off</span>}
          {isSelf && <span className="badge muted-badge">you</span>}
        </div>
        <div className="muted small-text">
          Today {formatMinutes(user.daySeconds)}/{formatMinutes(user.dailyLimitSeconds)} min
          {user.customDailyLimit ? '' : ' (default)'} · Month {formatMinutes(user.monthSeconds)}/
          {formatMinutes(user.monthlyLimitSeconds)} min{user.customMonthlyLimit ? '' : ' (default)'} · Last sign-in{' '}
          {user.lastLoginAt ? formatDay(user.lastLoginAt) : 'never'}
        </div>
      </div>
      {editing ? (
        <form
          className="limit-form"
          onSubmit={(e) => {
            e.preventDefault();
            void onUpdate({ dailyLimitMinutes: parseMinutes(daily), monthlyLimitMinutes: parseMinutes(monthly) }).then(() =>
              setEditing(false),
            );
          }}
        >
          <label className="field">
            <span>Daily minutes</span>
            <input inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="default" />
          </label>
          <label className="field">
            <span>Monthly minutes</span>
            <input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="default" />
          </label>
          <button className="btn small primary" type="submit">Save</button>
          <button className="btn small ghost" type="button" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : confirmDelete ? (
        <div className="inline-confirm">
          Delete {user.username} permanently?
          <button className="btn small danger" onClick={() => void onDelete()}>Delete</button>
          <button className="btn small" onClick={() => setConfirmDelete(false)}>Cancel</button>
        </div>
      ) : (
        <div className="user-actions">
          <button className="btn small" onClick={startEdit}>Limits</button>
          <button className="btn small" onClick={() => void onUpdate({ enhanceAllowed: !user.enhanceAllowed })}>
            {user.enhanceAllowed ? 'Turn AI off' : 'Turn AI on'}
          </button>
          <button className="btn small" onClick={() => void onResetCode()}>Reset password</button>
          {!isSelf && (
            <>
              <button className="btn small" onClick={() => void onUpdate({ disabled: !user.disabled })}>
                {user.disabled ? 'Enable' : 'Disable'}
              </button>
              <button className="btn small" onClick={() => void onUpdate({ role: user.role === 'admin' ? 'user' : 'admin' })}>
                {user.role === 'admin' ? 'Make user' : 'Make admin'}
              </button>
              <button className="btn small danger-outline" onClick={() => setConfirmDelete(true)}>Delete</button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
