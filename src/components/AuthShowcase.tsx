import { useEffect, useState, type ReactNode } from 'react';

/**
 * The animated example on the sign-in screen: a mixed Arabic and English handover is "spoken",
 * transcribed and turned into an SBAR report, then loops. Purely decorative — it calls no API.
 * People who ask for reduced motion (and test environments) see the finished state, still.
 */

const EN = 'Patient is stable, vital signs are normal.';
const AR = 'المريض stable وما عنده ألم، known diabetic ودخل أمس، نحتاج نتابع الـ blood glucose كل أربع ساعات.';

const ROWS = [
  { letter: 'S', label: 'Situation', text: 'Patient stable, vital signs normal.' },
  { letter: 'B', label: 'Background', text: 'Known diabetic, admitted yesterday.' },
  { letter: 'A', label: 'Assessment', text: 'No acute concerns this shift.' },
  { letter: 'R', label: 'Recommendation', text: 'Check blood glucose every 4 hours.' },
] as const;

const STEPS = [
  { title: 'Speak', sub: 'Voice by ElevenLabs' },
  { title: 'Structure', sub: 'AI by Gemini' },
  { title: 'Paste', sub: 'Into any record' },
] as const;

const BARS = [14, 24, 18, 30, 20, 12, 26, 16, 28, 10, 22, 30, 14, 24, 18, 12, 26, 16];

const TICK_MS = 55;
const AR_START = EN.length + 10;
const AR_END = AR_START + AR.length;
const SBAR_START = AR_END + 12;
const ROW_GAP = 9;
const READY = SBAR_START + 3 * ROW_GAP + 6;
const COPIED = SBAR_START + 4 * ROW_GAP + 10;
const LOOP = COPIED + 55;

function prefersStill(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function clock(t: number): string {
  const secs = 42 + Math.floor((t * TICK_MS) / 1000);
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

function CheckIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

function MicIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

/**
 * Renders two siblings for the sign-in layout: the hero column (the `intro` passed in, then the
 * animated example) and the Speak → Structure → Paste rail that sits between it and the form.
 */
export function AuthShowcase({ intro }: { intro: ReactNode }) {
  const [still] = useState(prefersStill);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (still) return;
    const id = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [still]);

  const t = still ? LOOP : tick % (LOOP + 1);
  const ready = t >= READY;
  const copied = t >= COPIED;
  const phase = t < AR_END ? 0 : ready ? 2 : 1;
  const enText = EN.slice(0, Math.min(t, EN.length));
  const arText = AR.slice(0, Math.max(0, Math.min(t - AR_START, AR.length)));

  return (
    <>
      <section className="auth-hero">
        {intro}
        <div
          className="auth-demo"
          role="img"
          aria-label="Example: a mixed Arabic and English handover is transcribed and turned into an SBAR report"
        >
          <div className="auth-demo-bar" aria-hidden="true">
            <span className="auth-mic">
              <span className="auth-halo" />
              <span className="auth-halo auth-halo-late" />
              <span className="auth-mic-core">
                <MicIcon />
              </span>
            </span>
            <span className="auth-demo-title">
              <strong>Recording handover</strong>
              <span>{t >= AR_START ? 'Arabic + English detected' : 'English detected'}</span>
            </span>
            <span className="auth-wave">
              {BARS.map((h, i) => (
                <span key={i} style={{ height: h, animationDelay: `-${((i * 0.137) % 1).toFixed(2)}s` }} />
              ))}
            </span>
            <span className="auth-rec">
              <span className="auth-rec-dot" />
              {clock(t)}
            </span>
          </div>

          <div className="auth-transcript" aria-hidden="true">
            <span className="auth-overline">Transcript</span>
            <div className="auth-line">
              <span className="auth-chip">EN</span>
              <p lang="en">
                {enText}
                {t < AR_START && <span className="auth-caret" />}
              </p>
            </div>
            {t >= AR_START && (
              <div className="auth-line auth-rise">
                <span className="auth-chip auth-chip-mixed">AR + EN</span>
                <p dir="rtl" lang="ar" className="auth-ar">
                  {arText}
                  {t < SBAR_START && <span className="auth-caret" />}
                </p>
              </div>
            )}
          </div>

          <div className="auth-report" aria-hidden="true">
            <div className="auth-report-head">
              <span className="auth-overline">SBAR report</span>
              {phase === 0 && <span className="auth-status">Listening</span>}
              {phase === 1 && (
                <span className="auth-status auth-status-busy">
                  <svg className="auth-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                    <path d="M12 3a9 9 0 1 1-9 9" />
                  </svg>
                  Structuring
                </span>
              )}
              {phase === 2 && (
                <span className="auth-status auth-status-ready auth-pop">
                  <CheckIcon />
                  Ready to paste
                </span>
              )}
            </div>
            <div className="auth-rows">
              {ROWS.map(
                (row, i) =>
                  t >= SBAR_START + i * ROW_GAP && (
                    <div key={row.letter} className="auth-row auth-rise">
                      <span className={`auth-letter auth-letter-${row.letter.toLowerCase()}`}>{row.letter}</span>
                      <span className="auth-row-text">
                        <strong>{row.label}</strong>
                        <span>{row.text}</span>
                      </span>
                    </div>
                  ),
              )}
            </div>
            <div className="auth-copy-row">
              {copied ? (
                <span className="auth-copy auth-copy-done auth-pop">
                  <CheckIcon size={14} />
                  Copied to clipboard
                </span>
              ) : (
                <span className="auth-copy">Copy report</span>
              )}
            </div>
          </div>
        </div>

      </section>

      <ol className="auth-steps" aria-label="How it works">
        {STEPS.map((step, i) => {
          const active = i === phase && !(i === 2 && copied);
          const done = i < phase || (i === 2 && copied);
          return (
            <li key={step.title} className="auth-step-item">
              <div className={`auth-step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
                <span className="auth-step-badge" aria-hidden="true">
                  {done ? <CheckIcon size={14} /> : i + 1}
                </span>
                <span className="auth-step-text">
                  <strong>{step.title}</strong>
                  <span>{step.sub}</span>
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <svg
                  className={`auth-step-link${i < phase ? ' is-done' : ''}`}
                  width="20"
                  height="40"
                  viewBox="0 0 20 40"
                  fill="none"
                  aria-hidden="true"
                >
                  <path className="auth-step-dash" d="M10 2v28" strokeWidth="2" strokeLinecap="round" />
                  <path d="M4 28l6 7 6-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
