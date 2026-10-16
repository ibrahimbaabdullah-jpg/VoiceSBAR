// SBAR handoff rules shared by the browser and the server, ported from nursing-sbar-handoff/sbar.py.
// The report shown to the user must be backed, line by line, by an exact quote from the notes.

export const SBAR_LANGUAGES = ['ar', 'en'] as const;
export type SbarLanguage = (typeof SBAR_LANGUAGES)[number];

export const MAX_NOTES = 6000;
export const MIN_NOTES = 20;
/** Seconds between Gemini requests from one account (sbar.py used ten seconds per session). */
export const SBAR_COOLDOWN_SECONDS = 10;
const MAX_ITEMS_PER_SECTION = 30;

/** Section key → [letter, Arabic title, Arabic hint]. The letter stays Latin in Arabic UI. */
export const SECTIONS = {
  situation: ['S', 'الوضع', 'ما الذي يحدث الآن؟'],
  background: ['B', 'الخلفية', 'ما الخلفية ذات الصلة؟'],
  assessment: ['A', 'التقييم', 'ما الملاحظات والقياسات المذكورة؟'],
  recommendation: ['R', 'التوصية', 'ما الخطة الموثقة للوردية التالية؟'],
} as const;
export type SectionKey = keyof typeof SECTIONS;
export const SECTION_KEYS = Object.keys(SECTIONS) as SectionKey[];

export const CHECKS = {
  allergies: 'الحساسية وردود الفعل',
  vitals: 'آخر العلامات الحيوية وقيمها',
  vitals_time: 'وقت قياس العلامات الحيوية',
  history: 'التاريخ المرضي وسبب الدخول',
  medications: 'الأدوية والجرعات وآخر وقت إعطاء',
  consciousness: 'مستوى الوعي',
  pain: 'تقييم الألم',
  oxygen: 'الأكسجين أو دعم التنفس',
  lines: 'القساطر والمحاليل والأجهزة',
  plan: 'الخطة والمهام المعلقة للوردية التالية',
} as const;
export type CheckCategory = keyof typeof CHECKS;
export const CHECK_KEYS = Object.keys(CHECKS) as CheckCategory[];

export const STATUSES = {
  documented: 'مذكور',
  partial: 'غير مكتمل',
  missing: 'غير مذكور',
  unclear: 'غير واضح',
} as const;
export type CheckStatus = keyof typeof STATUSES;
export const STATUS_KEYS = Object.keys(STATUSES) as CheckStatus[];

export const DISCLAIMER = 'حالة وهمية للتعلّم فقط — مسودة تحتاج مراجعة بشرية، وليست توجيهًا علاجيًا.';

export interface SbarItem {
  text: string;
  evidence: string;
}

export interface ChecklistRow {
  category: CheckCategory;
  status: CheckStatus;
  evidence: string;
}

export type SbarReport = Record<SectionKey, SbarItem[]> & { checklist: ChecklistRow[] };

export interface SbarRequestBody {
  notes: string;
  language: SbarLanguage;
  /** The user confirmed the case is fictional and agreed to send it to the providers. */
  consent: boolean;
}

export interface SbarResponse {
  report: SbarReport;
  language: SbarLanguage;
  model: string;
}

/** A safe, user-facing failure. `message` is the Arabic source string; translate it with `tr`. */
export class SbarError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SbarError';
    this.code = code;
  }
}

export const INVALID_REPORT_MESSAGE = 'تعذّر التحقق من التقرير. لم يُعرض نص غير موثّق؛ حاول مرة أخرى أو وضّح الملاحظات.';

export function normalizeLanguage(language: unknown): SbarLanguage {
  return language === 'ar' || language === 'en' ? language : 'ar';
}

/** Python's len() counts code points, not UTF-16 units. */
const charCount = (value: string) => [...value].length;

export function validateNotes(notes: string): string {
  const trimmed = notes.trim();
  if (charCount(trimmed) < MIN_NOTES) {
    throw new SbarError('sbar_notes_short', 'اكتب ملاحظات أوضح عن الحالة الوهمية (20 حرفًا على الأقل).');
  }
  if (charCount(trimmed) > MAX_NOTES) {
    throw new SbarError('sbar_notes_long', `اختصر الملاحظات إلى ${MAX_NOTES} حرف كحد أقصى.`);
  }
  return trimmed;
}

/**
 * Line wrapping is not a clinical change; numbers, punctuation and negation remain untouched.
 * Models sometimes replace the source's newline by a space.
 */
export function evidenceInNotes(evidence: string, notes: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const quote = normalize(evidence);
  return Boolean(quote) && normalize(notes).includes(quote);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(value, k));
};

const REPORT_KEYS = [...SECTION_KEYS, 'checklist'] as const;

/** Fails closed on malformed responses or evidence absent from the source. */
export function validateReport(data: unknown, notes: string): SbarReport {
  const invalid = () => new SbarError('sbar_unverified', INVALID_REPORT_MESSAGE);
  if (!isRecord(data) || !hasExactKeys(data, REPORT_KEYS)) throw invalid();
  for (const key of SECTION_KEYS) {
    const items = data[key];
    if (!Array.isArray(items) || items.length > MAX_ITEMS_PER_SECTION) throw invalid();
    for (const item of items) {
      if (!isRecord(item) || !hasExactKeys(item, ['text', 'evidence'])) throw invalid();
      for (const field of ['text', 'evidence'] as const) {
        const value = item[field];
        if (typeof value !== 'string' || !value.trim() || charCount(value.trim()) > MAX_NOTES) throw invalid();
      }
      if (!evidenceInNotes(item.evidence as string, notes)) throw invalid();
    }
  }
  const rows = data.checklist;
  if (!Array.isArray(rows) || rows.length !== CHECK_KEYS.length) throw invalid();
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row) || !hasExactKeys(row, ['category', 'status', 'evidence'])) throw invalid();
    const { category, status, evidence } = row;
    if (typeof category !== 'string' || typeof status !== 'string' || typeof evidence !== 'string') throw invalid();
    if (!Object.hasOwn(CHECKS, category) || seen.has(category) || !Object.hasOwn(STATUSES, status)) throw invalid();
    if (status === 'missing' && evidence !== '') throw invalid();
    if (status !== 'missing' && (!evidence.trim() || !evidenceInNotes(evidence, notes))) throw invalid();
    seen.add(category);
  }
  return data as unknown as SbarReport;
}

export function missingItems(report: SbarReport): ChecklistRow[] {
  return report.checklist.filter((row) => row.status !== 'documented');
}
