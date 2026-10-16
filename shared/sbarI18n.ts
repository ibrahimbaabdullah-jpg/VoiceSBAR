// Arabic source strings with English translations. Patient text and model output are never translated.
import type { SbarLanguage } from './sbar';
import { SBAR_EN } from './sbarStrings.generated';

/**
 * Strings the combined app adds on top of i18n.py: the voice capture stage, the consent that now
 * names both providers, and the server-side limits. The first group comes from the VoiceSBAR
 * design system's HandoffScreen; the rest are new here.
 */
const VOICESBAR_EN: Record<string, string> = {
  'مِن الملاحظات المنطوقة إلى تسليم أوضح': 'From spoken notes to a clearer handoff',
  'مُلخِّص التسليم التمريضي بالصوت': 'Nursing Handoff, by voice',
  'اضغط مطولًا على الميكروفون وقل ملاحظاتك كما هي، بالعربية أو الإنجليزية أو كلتيهما. حوّلها إلى تقرير SBAR منظم، راجع التفاصيل التي تحتاج إكمالًا، ثم انسخ التقرير أو اطبعه.':
    'Hold the mic and speak your notes as they are, in Arabic, English or both. Turn them into a structured SBAR report, review the details that need completing, then copy or print it.',
  'أملِ حالة وهمية': 'Dictate a fictional case',
  '01 · إملاء الملاحظات': '01 · Dictate notes',
  'مُملى': 'Dictated',
  'مكتوب': 'Typed',
  'أؤكد أن الحالة وهمية وأوافق على إرسال الصوت إلى ElevenLabs والملاحظات إلى Gemini.':
    'I confirm this case is fictional and agree to send the audio to ElevenLabs and the notes to Gemini.',
  'عرض العبارات الأصلية': 'Show source quotes',
  'VoiceSBAR · مشروع تعليمي يجمع VoiceScribe ومُلخِّص التسليم التمريضي. راجع التقرير دائمًا. هذه الأداة غير معتمدة للاستخدام السريري.':
    'VoiceSBAR · educational project combining VoiceScribe and the Nursing SBAR Handoff Summarizer. Always review the report. Not approved for clinical use.',
  // New in VoiceSBAR.
  'مُملى ثم عُدّل': 'Dictated, then edited',
  'أكد أولًا أن الحالة وهمية وأنك توافق على الإرسال، ثم ابدأ التسجيل.':
    'First confirm that the case is fictional and that you consent to sending it, then start recording.',
  'عند التسجيل يُرسل الصوت إلى ElevenLabs لتفريغه، وعند إنشاء التقرير تُرسل الملاحظات إلى Google Gemini. لا يحفظ هذا الموقع الصوت أو الملاحظات أو التقارير على الخادم. قد يعالج كل مزوّد المحتوى وفق شروطه.':
    'When you record, the audio is sent to ElevenLabs for transcription. When you generate a report, the notes are sent to Google Gemini. This site does not store audio, notes or reports on its server. Each provider may process content under its own terms.',
  'تم النسخ': 'Copied',
  'منع المتصفح النسخ التلقائي. حدّد نص التقرير أدناه وانسخه يدويًا.':
    'Your browser blocked copying. Select the report text below and copy it manually.',
  'نص التقرير': 'Report text',
  'وصلت إلى الحد اليومي لتقارير SBAR. حاول مجددًا غدًا.': 'You have reached the daily limit for SBAR reports. Try again tomorrow.',
  'لا تحفظ ملاحظات التسليم في السجل.': 'Handoff notes are not saved to History.',
  'اللغة': 'Language',
};

export function tr(text: string, language: SbarLanguage = 'ar'): string {
  if (language === 'ar') return text;
  return SBAR_EN[text] ?? VOICESBAR_EN[text] ?? text;
}

/** Fills `{name}` and `{name:,}` placeholders (the Python format specs used in i18n.py). */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)(:,)?\}/g, (match, name: string, comma?: string) => {
    const value = values[name];
    if (value === undefined) return match;
    // Python's {:,} uses Western digits and commas in both languages; keep numbers exact.
    return comma && typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
  });
}
