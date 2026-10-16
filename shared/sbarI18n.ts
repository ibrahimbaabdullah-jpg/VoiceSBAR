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

/**
 * The recorder (DictatePanel) is shared with the English-only Dictate tab, so its strings stay
 * English in the code and are translated here only when the Handoff tab is in Arabic. Templates use
 * the same `{name}` placeholders as `format`. Arabic for the idle, live and busy states and the
 * mode buttons follows the VoiceSBAR design system's HandoffScreen.
 */
export const RECORDER_AR: Record<string, string> = {
  // Recorder controls
  Language: 'اللغة',
  'Auto (Arabic + English)': 'تلقائي (العربية + الإنجليزية)',
  'Mostly Arabic': 'غالبًا العربية',
  'Mostly English': 'غالبًا الإنجليزية',
  'Recording mode': 'طريقة التسجيل',
  'Hold to talk': 'اضغط مطولًا للتحدث',
  'Tap to toggle': 'نقرة للتبديل',
  'Tap to start': 'انقر للبدء',
  'Tap to stop': 'انقر للإيقاف',
  'Record — hold to talk': 'تسجيل — اضغط مطولًا للتحدث',
  'Record — tap to start': 'تسجيل — انقر للبدء',
  'Recording — release to stop': 'جارٍ التسجيل — اترك الزر للإيقاف',
  'Recording — tap to stop': 'جارٍ التسجيل — انقر للإيقاف',
  'or hold {key} on your keyboard': 'أو اضغط مطولًا على {key} في لوحة المفاتيح',
  'or press {key} to start and stop': 'أو اضغط {key} للبدء والإيقاف',
  'Release to transcribe': 'اترك الزر للتفريغ',
  'Tap again to transcribe': 'انقر مرة أخرى للتفريغ',
  'Esc to discard': 'Esc للتجاهل',
  'Starting microphone…': 'جارٍ تشغيل الميكروفون…',
  'Listening… {elapsed} / {max}': 'جارٍ التسجيل… {elapsed} / {max}',
  'Transcribing…': 'جارٍ التفريغ…',
  Ready: 'جاهز',
  'AI clean-up': 'تحسين بالذكاء الاصطناعي',
  'My vocabulary ({count}) · extra cost': 'مفرداتي ({count}) · تكلفة إضافية',
  'Adds an extra ElevenLabs charge (keyterm prompting). See the Vocabulary page.':
    'يضيف رسومًا إضافية من ElevenLabs (تلميح المصطلحات). راجع صفحة المفردات.',
  // Editor
  'Text direction': 'اتجاه النص',
  Auto: 'تلقائي',
  'Each paragraph follows its own language': 'كل فقرة تتبع لغتها',
  'Right to left': 'من اليمين إلى اليسار',
  'Left to right': 'من اليسار إلى اليمين',
  'Last: {language} · {seconds} s': 'آخر تسجيل: {language} · {seconds} ث',
  '{count} vocabulary terms': '{count} من المفردات',
  'AI cleaned': 'حُسّن بالذكاء الاصطناعي',
  Arabic: 'العربية',
  English: 'الإنجليزية',
  Unknown: 'غير معروفة',
  'Improve punctuation (AI)': 'تحسين الترقيم (ذكاء اصطناعي)',
  Undo: 'تراجع',
  // Notices and their buttons
  Discard: 'تجاهل',
  Retry: 'إعادة المحاولة',
  'Send anyway': 'أرسل على أي حال',
  'Done.': 'تم.',
  "You're offline. Your recording is kept — press Retry when you're back online.":
    'أنت غير متصل بالإنترنت. احتفظنا بتسجيلك — اضغط «إعادة المحاولة» عند عودة الاتصال.',
  'No speech was recognized in that recording.': 'لم يُتعرَّف على كلام في هذا التسجيل.',
  'Transcription failed.': 'تعذّر التفريغ.',
  "{message} Your recording is kept, so you don't need to speak again.":
    '{message} احتفظنا بتسجيلك، فلا داعي للتحدث مرة أخرى.',
  'Keep holding the button while you speak, then let go.': 'استمر بالضغط على الزر أثناء الكلام، ثم اتركه.',
  'Keep holding the button (or {key}) while you speak, then let go.': 'استمر بالضغط على الزر (أو {key}) أثناء الكلام، ثم اتركه.',
  "We didn't hear anything, so nothing was sent and no credits were used. Check that the right microphone is selected in Settings.":
    'لم نسمع شيئًا، لذلك لم يُرسل شيء ولم يُستهلك أي رصيد. تأكد من اختيار الميكروفون الصحيح في الإعدادات.',
  'You reached the maximum recording length, so the recording was sent automatically.':
    'وصلت إلى أقصى مدة للتسجيل، فأُرسل التسجيل تلقائيًا.',
  'Recording discarded. Nothing was sent.': 'تم تجاهل التسجيل. لم يُرسل شيء.',
  'Punctuation and formatting improved. Use Undo to go back.': 'تحسّنت علامات الترقيم والتنسيق. استخدم «تراجع» للعودة.',
  'The text already looks good — nothing was changed.': 'النص جيد بالفعل — لم يتغير شيء.',
  'AI clean-up was not applied.': 'لم يُطبَّق التحسين بالذكاء الاصطناعي.',
  'AI clean-up failed.': 'تعذّر التحسين بالذكاء الاصطناعي.',
  'This browser cannot record audio. Please use a recent Chrome, Edge, Firefox or Safari over https.':
    'لا يستطيع هذا المتصفح تسجيل الصوت. استخدم إصدارًا حديثًا من Chrome أو Edge أو Firefox أو Safari عبر https.',
  'This browser cannot record audio on an insecure (http) page. Please use a recent Chrome, Edge, Firefox or Safari over https.':
    'لا يستطيع هذا المتصفح تسجيل الصوت في صفحة غير آمنة (http). استخدم إصدارًا حديثًا من Chrome أو Edge أو Firefox أو Safari عبر https.',
  // Microphone errors (src/audio/recorder.ts)
  'Microphone access is blocked. Click the lock or site-settings icon in the address bar, allow the microphone, then try again.':
    'الوصول إلى الميكروفون محظور. انقر على رمز القفل أو إعدادات الموقع في شريط العنوان، واسمح بالميكروفون، ثم حاول مجددًا.',
  'No microphone was found. Plug one in or pick another in Settings.': 'لم يُعثر على ميكروفون. وصّل ميكروفونًا أو اختر غيره من الإعدادات.',
  'The microphone could not be started. Another app may be using it; close it and try again.':
    'تعذّر تشغيل الميكروفون. قد يكون تطبيق آخر يستخدمه؛ أغلقه ثم حاول مجددًا.',
  'The microphone only works on a secure (https) page.': 'لا يعمل الميكروفون إلا في صفحة آمنة (https).',
  'The microphone could not be started. Please try again.': 'تعذّر تشغيل الميكروفون. حاول مجددًا.',
  'This browser cannot record audio. Please use a recent Chrome, Edge, Firefox or Safari.':
    'لا يستطيع هذا المتصفح تسجيل الصوت. استخدم إصدارًا حديثًا من Chrome أو Edge أو Firefox أو Safari.',
};

/** Translates a recorder string (English source) and fills its placeholders. Unknown text stays as is. */
export function trRecorder(text: string, language: SbarLanguage, values: Record<string, string | number> = {}): string {
  return format(language === 'ar' ? (RECORDER_AR[text] ?? text) : text, values);
}
