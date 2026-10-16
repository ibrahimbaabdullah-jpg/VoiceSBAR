import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MeResponse, UsageSummary } from '../../shared/api';
import {
  CHECK_KEYS,
  CHECKS,
  MAX_NOTES,
  missingItems,
  SbarError,
  SECTION_KEYS,
  SECTIONS,
  STATUSES,
  validateNotes,
  type CheckStatus,
  type ChecklistRow,
  type SbarLanguage,
  type SbarReport,
} from '../../shared/sbar';
import { sampleNotes, sampleReport } from '../../shared/sbarExamples';
import { format, tr } from '../../shared/sbarI18n';
import { api } from '../api/client';
import { copyText } from '../lib/clipboard';
import type { Settings } from '../lib/settings';
import { downloadFile, printDocument, reportText } from '../lib/sbarExport';
import { readJson, writeJson } from '../lib/storage';
import { DictatePanel, type HandoffOptions } from './DictatePanel';

interface Props {
  me: MeResponse;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  vocabularyCount: number;
  onUsage: (usage: UsageSummary) => void;
  active: boolean;
}

interface ShownReport {
  data: SbarReport;
  /** The notes revision and language (and language switch count) the report was generated from. */
  revision: number;
  language: SbarLanguage;
  languageSwitches: number;
  demo: boolean;
}

const LANGUAGE_KEY = 'vsbar.handoffLanguage.v1';
const STATUS_GLYPH: Record<CheckStatus, string> = { documented: '✓', partial: '◐', missing: '○', unclear: '?' };

function Notice({ kind, children }: { kind: 'info' | 'success' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

function StatusBadge({ status, language }: { status: CheckStatus; language: SbarLanguage }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span aria-hidden="true">{STATUS_GLYPH[status]}</span> {tr(STATUSES[status], language)}
    </span>
  );
}

function ChecklistRows({ rows, language, showEvidence }: { rows: ChecklistRow[]; language: SbarLanguage; showEvidence: boolean }) {
  return (
    <ul className="check-list">
      {rows.map((row) => (
        <li key={row.category} className="check-row">
          <div className="check-head">
            <span>{tr(CHECKS[row.category], language)}</span>
            <StatusBadge status={row.status} language={language} />
          </div>
          {showEvidence && row.evidence && <q className="evidence">{row.evidence}</q>}
        </li>
      ))}
    </ul>
  );
}

const MicGlyph = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
    />
  </svg>
);

/**
 * VoiceSBAR's main screen: dictate (VoiceScribe), structure with one Gemini call, review the S/B/A/R
 * report against its source quotes. Any change to the notes or the language hides the report.
 */
export function HandoffPanel({ me, settings, updateSettings, vocabularyCount, onUsage, active }: Props) {
  const [language, setLanguageState] = useState<SbarLanguage>(() =>
    readJson<string>(LANGUAGE_KEY, 'ar') === 'en' ? 'en' : 'ar',
  );
  const t = useCallback((text: string) => tr(text, language), [language]);
  const [notes, setNotes] = useState({ text: '', revision: 0 });
  // Switching back to the report's language does not bring the old report back.
  const [languageSwitches, setLanguageSwitches] = useState(0);
  const nextRevision = useRef(0);
  const [source, setSource] = useState({ dictated: false, typed: false });
  const [consent, setConsent] = useState(false);
  const [report, setReport] = useState<ShownReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [model, setModel] = useState<string | null>(null);

  /** Every change, typed or dictated, gets a new revision; a report only shows for its own revision. */
  const changeNotes = useCallback((value: string | ((prev: string) => string)) => {
    const revision = ++nextRevision.current;
    setNotes((prev) => ({ text: typeof value === 'function' ? value(prev.text) : value, revision }));
    setCopyState('idle');
  }, []);

  const setLanguage = (next: SbarLanguage) => {
    if (next === language) return;
    setLanguageState(next);
    setLanguageSwitches((n) => n + 1);
    writeJson(LANGUAGE_KEY, next);
  };

  const reset = () => {
    changeNotes('');
    setReport(null);
    setError(null);
    setConsent(false);
    setSource({ dictated: false, typed: false });
  };

  const loadExample = () => {
    reset();
    changeNotes(sampleNotes(language));
    setSource({ dictated: false, typed: true });
  };

  const previewExample = () => {
    loadExample();
    setReport({ data: sampleReport(language), revision: nextRevision.current, language, languageSwitches, demo: true });
  };

  const generate = async () => {
    // Clear prior results before every attempt so failures cannot leave a stale handoff.
    setReport(null);
    setError(null);
    if (!consent) {
      setError(t('أكد أولًا أن الملاحظات تخص حالة وهمية وأنك توافق على إرسالها.'));
      return;
    }
    try {
      validateNotes(notes.text);
    } catch (err) {
      setError(err instanceof SbarError ? t(err.message) : String(err));
      return;
    }
    const revision = notes.revision;
    const switches = languageSwitches;
    setBusy(true);
    try {
      const res = await api.sbar(notes.text, language, true);
      setModel(res.model);
      setReport({ data: res.report, revision, language: res.language, languageSwitches: switches, demo: false });
    } catch (err) {
      // Server messages are already in the selected language and never contain notes or keys.
      setError(err instanceof Error ? err.message : t('خدمة Gemini غير متاحة مؤقتًا. حاول لاحقًا.'));
    } finally {
      setBusy(false);
    }
  };

  const notesChanged = report !== null && report.revision !== notes.revision;
  const languageChanged =
    report !== null && !notesChanged && (report.language !== language || report.languageSwitches !== languageSwitches);
  const shown = report && !notesChanged && !languageChanged ? report : null;
  const text = useMemo(() => (shown ? reportText(shown.data, shown.demo, shown.language) : ''), [shown]);

  const doCopy = async () => {
    const method = await copyText(text);
    setCopyState(method === 'failed' ? 'failed' : 'copied');
  };

  const sourceLabel = source.dictated && source.typed ? 'مُملى ثم عُدّل' : source.dictated ? 'مُملى' : source.typed ? 'مكتوب' : null;
  const handoff: HandoffOptions = {
    language,
    sectionLabel: t('01 · إملاء الملاحظات'),
    editorId: 'handoff-notes',
    label: t('ملاحظات الحالة الوهمية'),
    placeholder: t('مثال: حالة وهمية، العمر 65 سنة، سبب الدخول...\nالساعة... الضغط... النبض... الحساسية...\nالخطة الموثقة للوردية التالية...'),
    maxLength: MAX_NOTES,
    meta: format(t('{count:,} / {maximum:,} حرف · لا تضف معلومات تعريفية حقيقية'), {
      count: [...notes.text].length,
      maximum: MAX_NOTES,
    }),
    chip: notes.text && sourceLabel && (
      <span className={`source-chip ${source.dictated ? 'dictated' : 'typed'}`}>
        {source.dictated && <MicGlyph />}
        {t(sourceLabel)}
      </span>
    ),
    // Audio goes to ElevenLabs, so the fictional-case consent comes before the first recording.
    recordBlocked: () => (consent ? null : t('أكد أولًا أن الحالة وهمية وأنك توافق على الإرسال، ثم ابدأ التسجيل.')),
    onSource: (kind) => setSource((prev) => ({ ...prev, [kind]: true })),
  };

  const step = shown ? 2 : notes.text.trim() ? 1 : 0;
  const steps = ['أملِ حالة وهمية', 'نظّمها مع Gemini', 'راجع وسلّم'];
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const missing = shown ? missingItems(shown.data) : [];

  return (
    <section className="handoff" dir={dir} lang={language} aria-label={t('تسليم')}>
      <div className="handoff-top">
        <div className="hero">
          <div className="eyebrow">{t('مِن الملاحظات المنطوقة إلى تسليم أوضح')}</div>
          <h1 className="display">{t('مُلخِّص التسليم التمريضي بالصوت')}</h1>
          <p className="lead">
            {t('اضغط مطولًا على الميكروفون وقل ملاحظاتك كما هي، بالعربية أو الإنجليزية أو كلتيهما. حوّلها إلى تقرير SBAR منظم، راجع التفاصيل التي تحتاج إكمالًا، ثم انسخ التقرير أو اطبعه.')}
          </p>
        </div>
        <div className="segmented" role="group" aria-label="اللغة / Language">
          {(['ar', 'en'] as const).map((value) => (
            <button
              key={value}
              type="button"
              lang={value}
              className={language === value ? 'on' : ''}
              aria-pressed={language === value}
              onClick={() => setLanguage(value)}
            >
              {value === 'ar' ? 'العربية' : 'English'}
            </button>
          ))}
        </div>
      </div>

      <ol className="steps">
        {steps.map((label, i) => (
          <li key={label} className="step" data-state={i < step ? 'done' : i === step ? 'current' : 'todo'} data-stage={i === 0 ? 'voice' : 'handoff'}>
            <span className="step-num">{i + 1}</span>
            {t(label)}
          </li>
        ))}
      </ol>

      <Notice kind="info">
        {t('للتعلّم بالحالات الوهمية فقط. لا تُدخل أسماء أو بيانات مرضى حقيقيين. التقرير مسودة للمراجعة وليس قرارًا سريريًا.')}
      </Notice>

      <details className="privacy">
        <summary>{t('إعدادات الاتصال والخصوصية')}</summary>
        <p className="hint">
          {t('عند التسجيل يُرسل الصوت إلى ElevenLabs لتفريغه، وعند إنشاء التقرير تُرسل الملاحظات إلى Google Gemini. لا يحفظ هذا الموقع الصوت أو الملاحظات أو التقارير على الخادم. قد يعالج كل مزوّد المحتوى وفق شروطه.')}
        </p>
        <p className="hint">{t('لا تحفظ ملاحظات التسليم في السجل.')}</p>
        {model && (
          <p className="hint">
            {format(t('النموذج: {model} · تتغير الحصة المجانية حسب حساب Google؛ لا يفعّل التطبيق فوترة مدفوعة.'), { model })}
          </p>
        )}
      </details>

      <div className="handoff-grid">
        <div className="stack">
          <div className="panel-head">
            <h2 className="section-title">{t('01 · إملاء الملاحظات')}</h2>
            <p className="hint">{t('العربية أو الإنجليزية، مختصرة أو غير مرتبة — المهم أن تكون الحالة وهمية.')}</p>
          </div>

          <label className="consent" data-hotkey-pass>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t('أؤكد أن الحالة وهمية وأوافق على إرسال الصوت إلى ElevenLabs والملاحظات إلى Gemini.')}</span>
          </label>

          <DictatePanel
            me={me}
            settings={settings}
            updateSettings={updateSettings}
            text={notes.text}
            setText={changeNotes}
            vocabularyCount={vocabularyCount}
            onUsage={onUsage}
            // Handoff notes stay in memory only; they are never written to the History tab.
            onTranscribed={() => undefined}
            active={active}
            handoff={handoff}
          />

          {error && <Notice kind="error">{error}</Notice>}
          <button
            type="button"
            className="btn primary big block"
            onClick={() => void generate()}
            disabled={busy || !notes.text.trim()}
            aria-busy={busy}
          >
            {busy ? t('جارٍ تنظيم الملاحظات وفحص مصادرها…') : t('إنشاء تقرير SBAR  ←')}
          </button>
          <div className="two">
            <button type="button" className="btn block" onClick={loadExample} disabled={busy}>
              {t('إدراج حالة وهمية')}
            </button>
            <button type="button" className="btn block" onClick={previewExample} disabled={busy}>
              {t('معاينة مثال جاهز')}
            </button>
          </div>
          <button type="button" className="btn danger-outline block" onClick={reset} disabled={busy}>
            {t('مسح الحالة والتقرير')}
          </button>
        </div>

        <div className="stack" aria-live="polite">
          <div className="panel-head between">
            <div>
              <h2 className="section-title">{t('02 · تقرير التسليم')}</h2>
              <p className="hint">{t('الوضع · الخلفية · التقييم · التوصية')}</p>
            </div>
            {shown && (
              <label className="consent compact" data-hotkey-pass>
                <input type="checkbox" checked={showEvidence} onChange={(e) => setShowEvidence(e.target.checked)} />
                <span>{t('عرض العبارات الأصلية')}</span>
              </label>
            )}
          </div>

          {notesChanged && <Notice kind="warn">{t('تغيّرت الملاحظات. أعد إنشاء التقرير لعرض نسخة تطابق النص الحالي.')}</Notice>}
          {languageChanged && (
            <Notice kind="warn">{t('تغيّرت اللغة. أعد إنشاء التقرير باللغة المختارة، أو افتح معاينة المثال الجاهز.')}</Notice>
          )}

          {shown ? (
            <>
              {shown.demo ? (
                <Notice kind="info">{t('معاينة تعليمية ثابتة للحالة المرفقة — لم يتم استدعاء Gemini.')}</Notice>
              ) : (
                <Notice kind="success">{t('تم تنظيم الملاحظات باستخدام Gemini. راجع المحتوى مقابل المصدر.')}</Notice>
              )}
              {SECTION_KEYS.map((key) => {
                const [letter, title, hint] = SECTIONS[key];
                const items = shown.data[key];
                return (
                  <article key={key} className="card sbar-card" aria-labelledby={`sbar-${key}`}>
                    <div className="sbar-head">
                      <span className="sbar-letter" aria-hidden="true">{letter}</span>
                      <div>
                        <h3 id={`sbar-${key}`} className="section-title">{t(title)}</h3>
                        <span className="caption">{t(hint)}</span>
                      </div>
                    </div>
                    {items.length ? (
                      <ul className="sbar-list">
                        {items.map((item, i) => (
                          <li key={i} className="sbar-item">
                            <p>{item.text}</p>
                            {showEvidence && <q className="evidence">{item.evidence}</q>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="sbar-empty">{t('غير مذكور في الملاحظات.')}</p>
                    )}
                  </article>
                );
              })}

              <h3 className="section-title">{t('معلومات ناقصة أو تحتاج توضيحًا')}</h3>
              {missing.length ? (
                <div className="card">
                  <ChecklistRows rows={missing} language={language} showEvidence />
                </div>
              ) : (
                <Notice kind="info">{t('لم يرصد الفحص الآلي نقصًا في قائمته المحدودة؛ هذا لا يؤكد اكتمال التسليم.')}</Notice>
              )}

              <details className="card review">
                <summary>{t('مراجعة العبارات الأصلية وقائمة الفحص')}</summary>
                <p className="hint">{t('وجود عبارة في المصدر لا يضمن صحة تفسير النموذج لها؛ راجع المعنى والأرقام بنفسك.')}</p>
                <ChecklistRows
                  rows={CHECK_KEYS.map((key) => shown.data.checklist.find((row) => row.category === key)!)}
                  language={language}
                  showEvidence={showEvidence}
                />
              </details>

              <div className="two">
                <button type="button" className="btn big block" onClick={() => void doCopy()}>
                  {copyState === 'copied' ? `✓ ${t('تم النسخ')}` : t('نسخ التقرير')}
                </button>
                <button
                  type="button"
                  className="btn big block"
                  onClick={() => downloadFile('sbar-handoff.txt', text, 'text/plain;charset=utf-8')}
                >
                  {t('تنزيل التقرير كنص')}
                </button>
              </div>
              <button
                type="button"
                className="btn block"
                onClick={() =>
                  downloadFile('sbar-handoff.html', printDocument(shown.data, shown.demo, shown.language), 'text/html;charset=utf-8')
                }
              >
                {t('تنزيل نسخة للطباعة / PDF')}
              </button>
              {copyState === 'failed' && <Notice kind="warn">{t('منع المتصفح النسخ التلقائي. حدّد نص التقرير أدناه وانسخه يدويًا.')}</Notice>}
              <details className="report-text" open={copyState === 'failed'}>
                <summary>{t('نص التقرير')}</summary>
                <pre>{text}</pre>
              </details>
            </>
          ) : (
            !notesChanged &&
            !languageChanged && (
              <div className="empty-report">
                <div className="empty-symbol" aria-hidden="true">▤</div>
                <h3 className="section-title">{t('تسليم واضح يبدأ بملاحظاتك')}</h3>
                <p className="hint">
                  {t('سيظهر تقريرك هنا بعد الإنشاء.')}
                  <br />
                  {t('أو اختر «معاينة مثال جاهز» لتتعرف على الشكل النهائي.')}
                </p>
                <span className="tag" dir="ltr">S / B / A / R</span>
              </div>
            )
          )}
        </div>
      </div>
      <p className="handoff-foot caption">
        {t('VoiceSBAR · مشروع تعليمي يجمع VoiceScribe ومُلخِّص التسليم التمريضي. راجع التقرير دائمًا. هذه الأداة غير معتمدة للاستخدام السريري.')}
      </p>
    </section>
  );
}
