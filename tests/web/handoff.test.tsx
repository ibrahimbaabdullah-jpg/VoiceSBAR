// The Handoff tab end to end in jsdom: consent, one /api/sbar call, the report, and the stale rule
// (any notes change, a new dictation or a language switch hides the report until it is regenerated).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SAMPLE_NOTES_EN, sampleReport } from '../../shared/sbarExamples';
import { App } from '../../src/App';
import { callsTo, installFakeMedia, json, ME, mockServer, sleep } from './fakes';

function server(extra: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/me': ME,
    'GET /api/vocabulary': { terms: [] },
    'POST /api/sbar': () => json({ report: sampleReport('en'), language: 'en', model: 'gemini-3.5-flash-lite' }),
    'POST /api/transcribe': () =>
      json({
        text: 'Pain 3/10 at 9 AM.',
        rawText: 'Pain 3/10 at 9 AM.',
        languageCode: 'eng',
        languageProbability: 0.98,
        durationSeconds: 2,
        keytermsUsed: 0,
        enhancement: { status: 'off' },
        usage: ME.usage,
      }),
    ...extra,
  });
}

/** Opens the app (Handoff is the default tab) and switches the handoff language to English. */
async function openHandoff() {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'English' }));
  return screen.getByRole('region', { name: 'Handoff' });
}

const notes = () => screen.getByLabelText('Fictional case notes') as HTMLTextAreaElement;
const consent = () => screen.getByLabelText(/I confirm this case is fictional/);
const generate = () => screen.getByRole('button', { name: /Generate SBAR report/ });

async function generateExampleReport() {
  fireEvent.click(screen.getByRole('button', { name: 'Insert fictional case' }));
  fireEvent.click(consent());
  fireEvent.click(generate());
  await screen.findByText('Notes organized with Gemini. Check the content against your source notes.');
}

describe('Handoff tab', () => {
  it('is the first tab and opens in Arabic, right to left', async () => {
    server();
    installFakeMedia();
    render(<App />);
    const tabs = await screen.findAllByRole('button', { name: /^(Handoff|Dictate|History|Vocabulary|Settings)$/ });
    expect(tabs[0]).toHaveTextContent('Handoff');
    const region = screen.getByRole('region', { name: 'تسليم' });
    expect(region).toHaveAttribute('dir', 'rtl');
    expect(within(region).getByText('للتعلّم بالحالات الوهمية فقط. لا تُدخل أسماء أو بيانات مرضى حقيقيين. التقرير مسودة للمراجعة وليس قرارًا سريريًا.')).toBeInTheDocument();
  });

  it('labels the recorder in Arabic, while the Dictate tab stays English', async () => {
    server();
    const media = installFakeMedia();
    render(<App />);
    const region = await screen.findByRole('region', { name: 'تسليم' });
    const record = within(region).getByRole('button', { name: 'تسجيل — اضغط مطولًا للتحدث' });
    expect(within(region).getByText('جاهز')).toBeInTheDocument();
    expect(within(region).getByRole('group', { name: 'طريقة التسجيل' })).toHaveTextContent('نقرة للتبديل');
    expect(within(region).getByRole('option', { name: 'تلقائي (العربية + الإنجليزية)' })).toBeInTheDocument();
    expect(within(region).queryByText('Hold to talk')).not.toBeInTheDocument();

    fireEvent.pointerDown(record, { button: 0, pointerId: 1 });
    expect(await within(region).findByText('أكد أولًا أن الحالة وهمية وأنك توافق على الإرسال، ثم ابدأ التسجيل.')).toBeInTheDocument();
    expect(media.getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    expect(screen.getByRole('button', { name: 'Record — hold to talk' })).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('does not open the microphone or call Gemini before consent', async () => {
    const fetchMock = server();
    const media = installFakeMedia();
    await openHandoff();
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Record —/ }), { button: 0, pointerId: 1 });
    expect(await screen.findByText(/then start recording/)).toBeInTheDocument();
    expect(media.getUserMedia).not.toHaveBeenCalled();

    fireEvent.change(notes(), { target: { value: SAMPLE_NOTES_EN } });
    fireEvent.click(generate());
    expect(await screen.findByRole('alert')).toHaveTextContent('First confirm that these notes describe a fictional case');
    expect(callsTo(fetchMock, 'POST', '/api/sbar')).toHaveLength(0);
  });

  it('shows the S/B/A/R cards, the flagged checklist and optional source quotes', async () => {
    const fetchMock = server();
    installFakeMedia();
    await openHandoff();
    await generateExampleReport();

    const [, init] = callsTo(fetchMock, 'POST', '/api/sbar')[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ notes: SAMPLE_NOTES_EN, language: 'en', consent: true });

    for (const title of ['Situation', 'Background', 'Assessment', 'Recommendation']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText('Pain 2/10. IV cannula in the left hand.')).toBeInTheDocument();
    const flagged = screen.getByRole('heading', { name: 'Missing information or details to clarify' }).nextElementSibling as HTMLElement;
    expect(within(flagged).getByText('Allergies and reactions')).toBeInTheDocument();
    expect(within(flagged).getByText(/Unclear/)).toBeInTheDocument();
    expect(within(flagged).getByText(/Incomplete/)).toBeInTheDocument();
    expect(within(flagged).queryByText('Pain assessment')).not.toBeInTheDocument();

    expect(screen.queryByText('Pain 2/10. Has an IV cannula in the left hand')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show source quotes'));
    expect(screen.getAllByText('Pain 2/10. Has an IV cannula in the left hand').length).toBeGreaterThan(0);
    expect(screen.getByText('Typed')).toBeInTheDocument();
  });

  it('hides the report when the notes are edited, until it is generated again', async () => {
    const fetchMock = server();
    installFakeMedia();
    await openHandoff();
    await generateExampleReport();

    fireEvent.change(notes(), { target: { value: `${SAMPLE_NOTES_EN} Pain now 4/10.` } });
    expect(screen.getByText('Your notes have changed. Generate a new report that matches the current text.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Situation' })).not.toBeInTheDocument();
    // Undoing the edit by hand does not bring the old report back either.
    fireEvent.change(notes(), { target: { value: SAMPLE_NOTES_EN } });
    expect(screen.queryByRole('heading', { name: 'Situation' })).not.toBeInTheDocument();

    fireEvent.click(generate());
    expect(await screen.findByRole('heading', { name: 'Situation' })).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/sbar')).toHaveLength(2);
  });

  it('hides the report after a new dictation', async () => {
    const fetchMock = server();
    installFakeMedia();
    await openHandoff();
    await generateExampleReport();

    const record = screen.getByRole('button', { name: /^Record —/ });
    fireEvent.pointerDown(record, { button: 0, pointerId: 1 });
    await screen.findByText(/Listening/);
    await sleep(500);
    fireEvent.pointerUp(record, { button: 0, pointerId: 1 });

    await waitFor(() => expect(notes().value).toContain('Pain 3/10 at 9 AM.'));
    expect(screen.getByText('Your notes have changed. Generate a new report that matches the current text.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Situation' })).not.toBeInTheDocument();
    expect(screen.getByText('Dictated, then edited')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/transcribe')).toHaveLength(1);
    // Handoff dictations are not copied to the clipboard or kept in History.
    expect(localStorage.getItem('wtc.history.v1.sara')).toBeNull();
  });

  it('hides the report after a language switch', async () => {
    server();
    installFakeMedia();
    await openHandoff();
    await generateExampleReport();
    fireEvent.click(screen.getByRole('button', { name: 'العربية' }));
    expect(screen.getByText('تغيّرت اللغة. أعد إنشاء التقرير باللغة المختارة، أو افتح معاينة المثال الجاهز.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'الوضع' })).not.toBeInTheDocument();
    // Switching back is still a change: the report stays hidden until it is generated again.
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.queryByRole('heading', { name: 'Situation' })).not.toBeInTheDocument();
    expect(screen.getByText('The language has changed. Generate a report in the selected language, or preview the example.')).toBeInTheDocument();
  });

  it('shows the server error and no report when verification fails', async () => {
    server({
      'POST /api/sbar': () =>
        json(
          {
            error: {
              code: 'sbar_unverified',
              message: 'The report could not be verified. Unverified text was not displayed; try again or clarify your notes.',
              retryable: true,
            },
          },
          502,
        ),
    });
    installFakeMedia();
    await openHandoff();
    fireEvent.click(screen.getByRole('button', { name: 'Insert fictional case' }));
    fireEvent.click(consent());
    fireEvent.click(generate());
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be verified');
    expect(screen.queryByRole('heading', { name: 'Situation' })).not.toBeInTheDocument();
  });

  it('previews the labelled example without calling Gemini', async () => {
    const fetchMock = server();
    installFakeMedia();
    await openHandoff();
    fireEvent.click(screen.getByRole('button', { name: 'Preview example' }));
    expect(screen.getByText('A fixed educational preview of this case — Gemini was not called.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Situation' })).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/sbar')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Clear case and report' }));
    expect(notes()).toHaveValue('');
    expect(screen.queryByRole('heading', { name: 'Situation' })).not.toBeInTheDocument();
  });
});
