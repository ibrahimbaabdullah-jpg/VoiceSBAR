import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { callsTo, installFakeMedia, json, ME, mockServer, sleep, type FakeRequest } from './fakes';

// PBKDF2 with 600k iterations is covered in passwordKey.test.ts; keep UI tests fast.
vi.mock('../../src/lib/passwordKey', () => ({
  derivePasswordKey: vi.fn(async (username: string) => `key-for-${username.trim().toLowerCase()}`.padEnd(43, 'x')),
}));

const TRANSCRIPT = 'المريض عنده hypertension ونعطيه amlodipine 5 mg';

function transcribeOk(text = TRANSCRIPT) {
  return () =>
    json({
      text,
      rawText: text,
      languageCode: 'ara',
      languageProbability: 0.98,
      durationSeconds: 3.2,
      keytermsUsed: 2,
      enhancement: { status: 'off' },
      usage: { ...ME.usage, daySeconds: 63.2 },
    });
}

function signedInServer(extra: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/me': ME,
    'GET /api/vocabulary': { terms: ['amlodipine', 'HbA1c'] },
    'POST /api/transcribe': transcribeOk(),
    ...extra,
  });
}

/** Opens the Dictate tab (Handoff is the default tab; its recorder waits for consent). */
async function renderSignedIn() {
  window.history.replaceState(null, '', '/#/dictate');
  render(<App />);
  return screen.findByRole('button', { name: /^Record —/ });
}

async function holdRecordButton(button: HTMLElement, ms = 500) {
  fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
  await screen.findByText(/Listening/);
  await sleep(ms);
  fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
}

describe('signing in', () => {
  it('shows the sign-in form when there is no session', async () => {
    mockServer({
      'GET /api/me': () => json({ error: { code: 'unauthorized', message: 'Please sign in' } }, 401),
      'GET /api/setup-status': { needsSetup: false, setupCodeConfigured: true, version: '0.1.0' },
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/invitation only/)).toBeInTheDocument();
    expect(document.querySelector('.brand-name')).toHaveTextContent('VoiceSBAR');
    expect(screen.getByText('by Ibrahim Baabdullah')).toBeInTheDocument();
    expect(screen.getByText('Dictated SBAR handoffs')).toBeInTheDocument();
  });

  it('guides the owner through first-run setup', async () => {
    mockServer({
      'GET /api/me': () => json({ error: { code: 'unauthorized', message: 'x' } }, 401),
      'GET /api/setup-status': { needsSetup: true, setupCodeConfigured: true, version: '0.1.0' },
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Set up your site' })).toBeInTheDocument();
    expect(screen.getByLabelText('Admin setup code')).toBeInTheDocument();
  });

  it('signs in with a stretched password key, never the password', async () => {
    let signedIn = false;
    const fetchMock = mockServer({
      'GET /api/me': () => (signedIn ? json(ME) : json({ error: { code: 'unauthorized', message: 'x' } }, 401)),
      'GET /api/setup-status': { needsSetup: false, setupCodeConfigured: true, version: '0.1.0' },
      'GET /api/vocabulary': { terms: [] },
      'POST /api/auth/login': () => {
        signedIn = true;
        return json({ user: ME.user });
      },
    });
    installFakeMedia();
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('Username'), 'Sara');
    await user.type(screen.getByLabelText('Password'), 'my secret password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('button', { name: /^Record —/ })).toBeInTheDocument();

    const [, init] = callsTo(fetchMock, 'POST', '/api/auth/login')[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ username: 'Sara', passwordKey: 'key-for-sara'.padEnd(43, 'x') });
    expect((init as RequestInit).body).not.toContain('my secret password');
    expect(new Headers((init as RequestInit).headers).get('x-wtc-client')).toBe('web');
  });

  it('prefills the invite code from an invite link', async () => {
    window.history.replaceState(null, '', '/#invite=WTC-ABCD-EFGH-JKMN-PQRS-TVWX');
    mockServer({
      'GET /api/me': () => json({ error: { code: 'unauthorized', message: 'x' } }, 401),
      'GET /api/setup-status': { needsSetup: false, setupCodeConfigured: true, version: '0.1.0' },
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Invite code')).toHaveValue('WTC-ABCD-EFGH-JKMN-PQRS-TVWX');
  });

  it('checks that the new passwords match before contacting the server', async () => {
    const fetchMock = mockServer({
      'GET /api/me': () => json({ error: { code: 'unauthorized', message: 'x' } }, 401),
      'GET /api/setup-status': { needsSetup: false, setupCodeConfigured: true, version: '0.1.0' },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'I have an invite code' }));
    await user.type(screen.getByLabelText('Invite code'), 'WTC-1234');
    await user.type(screen.getByLabelText('Username'), 'sara');
    await user.type(screen.getByLabelText('New password'), 'long enough password');
    await user.type(screen.getByLabelText('Repeat password'), 'different password!');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
    expect(callsTo(fetchMock, 'POST', '/api/auth/register')).toHaveLength(0);
  });
});

describe('dictation', () => {
  it('records while held, transcribes on release, inserts and copies the text', async () => {
    const fetchMock = signedInServer();
    const media = installFakeMedia();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    const button = await renderSignedIn();
    await holdRecordButton(button);

    const editor = screen.getByLabelText('Your text');
    await waitFor(() => expect(editor).toHaveValue(TRANSCRIPT));
    expect(editor).toHaveAttribute('dir', 'auto');
    expect(writeText).toHaveBeenCalledWith(TRANSCRIPT);
    expect(await screen.findByText(/the new text is on your clipboard/)).toBeInTheDocument();

    const [input, init] = callsTo(fetchMock, 'POST', '/api/transcribe')[0]!;
    const url = new URL(String(input), 'http://localhost');
    expect(url.searchParams.get('language')).toBe('auto');
    expect(url.searchParams.get('keyterms')).toBe('1'); // vocabulary exists and is on by default
    expect(url.searchParams.get('enhance')).toBe('0'); // AI clean-up is opt-in
    expect(url.searchParams.get('noVerbatim')).toBe('1');
    expect(Number(url.searchParams.get('duration'))).toBeGreaterThan(0.4);
    expect(new Headers((init as RequestInit).headers).get('content-type')).toBe('audio/webm;codecs=opus');
    expect((init as RequestInit).body).toBeInstanceOf(Blob);

    // The microphone is released after each recording by default.
    expect(media.trackStop).toHaveBeenCalled();
    // History is saved on this device only.
    expect(JSON.parse(localStorage.getItem('wtc.history.v1.sara')!)[0]).toMatchObject({ text: TRANSCRIPT });
    // The header shows the product brand.
    expect(screen.getByText('by Ibrahim Baabdullah')).toBeInTheDocument();
    // Usage in the header is updated from the response.
    expect(screen.getByText('1.1/30')).toBeInTheDocument();
  });

  it('appends later dictations with a space', async () => {
    let n = 0;
    signedInServer({ 'POST /api/transcribe': () => transcribeOk(n++ === 0 ? 'First part.' : 'Second part.')() });
    installFakeMedia();
    const button = await renderSignedIn();
    await holdRecordButton(button);
    await waitFor(() => expect(screen.getByLabelText('Your text')).toHaveValue('First part.'));
    await holdRecordButton(await screen.findByRole('button', { name: /^Record —/ }));
    await waitFor(() => expect(screen.getByLabelText('Your text')).toHaveValue('First part. Second part.'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Your text')).toHaveValue('First part.');
  });

  it('ignores accidental taps in hold-to-talk mode', async () => {
    const fetchMock = signedInServer();
    installFakeMedia();
    const button = await renderSignedIn();
    await holdRecordButton(button, 0);
    expect(await screen.findByText(/Keep holding the button/)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/transcribe')).toHaveLength(0);
  });

  it('does not upload silent recordings unless asked', async () => {
    const fetchMock = signedInServer();
    installFakeMedia({ silent: true });
    const button = await renderSignedIn();
    await holdRecordButton(button);
    expect(await screen.findByText(/didn't hear anything/)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/transcribe')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/transcribe')).toHaveLength(1));
  });

  it('keeps the recording after a failure so it can be retried without speaking again', async () => {
    let attempts = 0;
    const fetchMock = signedInServer({
      'POST /api/transcribe': () => {
        attempts += 1;
        if (attempts === 1) {
          return json(
            { error: { code: 'stt_busy', message: 'ElevenLabs is busy right now.', retryable: true } },
            503,
          );
        }
        return transcribeOk()();
      },
    });
    installFakeMedia();
    const button = await renderSignedIn();
    await holdRecordButton(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(/busy.*recording is kept/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByLabelText('Your text')).toHaveValue(TRANSCRIPT));
    const bodies = callsTo(fetchMock, 'POST', '/api/transcribe').map(([, init]) => (init as RequestInit).body);
    expect(bodies[0]).toBe(bodies[1]); // the same audio was re-sent
  });

  it('explains when the daily limit is reached', async () => {
    signedInServer({
      'POST /api/transcribe': () =>
        json({ error: { code: 'daily_quota_exceeded', message: 'You have used 30 of your 30 minutes for today.' } }, 429),
    });
    installFakeMedia();
    await holdRecordButton(await renderSignedIn());
    expect(await screen.findByRole('alert')).toHaveTextContent('You have used 30 of your 30 minutes');
  });

  it('shows a clear message when microphone access is blocked', async () => {
    signedInServer();
    const media = installFakeMedia();
    media.getUserMedia.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const button = await renderSignedIn();
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Microphone access is blocked/);
  });

  it('supports holding the keyboard shortcut', async () => {
    const fetchMock = signedInServer();
    installFakeMedia();
    await renderSignedIn();
    fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
    await screen.findByText(/Listening/);
    await sleep(500);
    fireEvent.keyUp(document.body, { code: 'Space', key: ' ' });
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/transcribe')).toHaveLength(1));
  });

  it('does not start recording when Space is typed in the editor', async () => {
    signedInServer();
    const media = installFakeMedia();
    await renderSignedIn();
    fireEvent.keyDown(screen.getByLabelText('Your text'), { code: 'Space', key: ' ' });
    await sleep(50);
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it('supports tap-to-toggle mode', async () => {
    const fetchMock = signedInServer();
    installFakeMedia();
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Tap to toggle' }));
    const button = screen.getByRole('button', { name: 'Record — tap to start' });
    fireEvent.click(button);
    await screen.findByText(/Listening/);
    await sleep(300);
    fireEvent.click(screen.getByRole('button', { name: 'Recording — tap to stop' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/transcribe')).toHaveLength(1));
  });

  it('sends the AI clean-up flag when the user turns it on', async () => {
    const fetchMock = signedInServer();
    installFakeMedia();
    const button = await renderSignedIn();
    fireEvent.click(screen.getByRole('checkbox', { name: 'AI clean-up' }));
    await holdRecordButton(button);
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/transcribe')).toHaveLength(1));
    const url = new URL(String(callsTo(fetchMock, 'POST', '/api/transcribe')[0]![0]), 'http://localhost');
    expect(url.searchParams.get('enhance')).toBe('1');
  });

  it('falls back to selecting the text when copying is blocked', async () => {
    signedInServer();
    installFakeMedia();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = vi.fn().mockReturnValue(false);
    await renderSignedIn();
    const editor = screen.getByLabelText('Your text') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'نص للنسخ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }));
    expect(await screen.findByText(/press Ctrl\+C/)).toBeInTheDocument();
    expect(document.activeElement).toBe(editor);
  });

  it('lets the user force right-to-left or left-to-right', async () => {
    signedInServer();
    installFakeMedia();
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'RTL' }));
    expect(screen.getByLabelText('Your text')).toHaveAttribute('dir', 'rtl');
    fireEvent.click(screen.getByRole('button', { name: 'LTR' }));
    expect(screen.getByLabelText('Your text')).toHaveAttribute('dir', 'ltr');
  });
});

describe('other pages', () => {
  it('validates and saves the vocabulary with a cost notice', async () => {
    let saved: string[] = ['amlodipine'];
    const fetchMock = signedInServer({
      'GET /api/vocabulary': () => json({ terms: saved }),
      'PUT /api/vocabulary': (req: FakeRequest) => {
        saved = JSON.parse(req.init.body as string).terms;
        return json({ terms: saved });
      },
    });
    installFakeMedia();
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Vocabulary' }));
    expect(await screen.findByText(/Extra cost/)).toBeInTheDocument();
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: 'amlodipine\nbad {term}' } });
    expect(screen.getByRole('alert')).toHaveTextContent('cannot contain');
    expect(screen.getByRole('button', { name: 'Save vocabulary' })).toBeDisabled();
    fireEvent.change(box, { target: { value: 'amlodipine\nHbA1c\nhba1c' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save vocabulary' }));
    expect(await screen.findByText('Saved 2 terms.')).toBeInTheDocument();
    expect(saved).toEqual(['amlodipine', 'HbA1c']);
    expect(callsTo(fetchMock, 'PUT', '/api/vocabulary')).toHaveLength(1);
  });

  it('lists history and copies entries', async () => {
    localStorage.setItem(
      'wtc.history.v1.sara',
      JSON.stringify([
        { id: 'a', createdAt: Date.now(), text: 'نص قديم', rawText: 'نص قديم', languageCode: 'ar', durationSeconds: 2, enhanced: false },
      ]),
    );
    signedInServer();
    installFakeMedia();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByText('نص قديم')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('نص قديم'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to editor' }));
    expect(screen.getByLabelText('Your text')).toHaveValue('نص قديم');
  });

  it('shows the admin page only to admins', async () => {
    signedInServer();
    installFakeMedia();
    await renderSignedIn();
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('lets an admin create an invite code', async () => {
    const admin = { ...ME, user: { ...ME.user, id: 1, username: 'owner', role: 'admin' as const } };
    mockServer({
      'GET /api/me': admin,
      'GET /api/vocabulary': { terms: [] },
      'GET /api/admin/overview': {
        day: '2026-10-16', month: '2026-10', timeZone: 'UTC', dayAudioSeconds: 120, monthAudioSeconds: 3600,
        monthKeytermSeconds: 0, dayRequests: 3, dayErrors: 0, monthEnhanceRequests: 0, globalDailyLimitSeconds: 10800,
        globalMonthlyLimitSeconds: 90000, estimatedMonthCostUsd: 0.22, users: 1,
        providers: { elevenlabsConfigured: true, enhancementConfigured: false, enhanceModel: 'gpt-6-luna' },
      },
      'GET /api/admin/users': { users: [] },
      'GET /api/admin/invites': { invites: [] },
      'POST /api/admin/invites': () => json({ code: 'WTC-AAAA-BBBB-CCCC-DDDD-EEEE', expiresAt: 1790000000 }, 201),
    });
    installFakeMedia();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Admin' }));
    expect(await screen.findByText('$0.22')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create invite code' }));
    expect(await screen.findByText('WTC-AAAA-BBBB-CCCC-DDDD-EEEE')).toBeInTheDocument();
  });
});
