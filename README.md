# VoiceSBAR

**by Ibrahim Baabdullah · Dictate nursing notes, get a source-checked SBAR handoff**

[العربية](#نبذة-عن-المشروع) · [Tech stack](#tech-stack) · [Run it locally](#run-it-locally) · [Privacy](#privacy) · [Credits](#credits-and-licence)

VoiceSBAR is a bilingual (Arabic by default, plus English) educational web app. You dictate nursing notes about a
**fictional** patient, and it turns them into a structured **SBAR** handoff report (Situation, Background,
Assessment, Recommendation), with a checklist that flags information that is missing or incomplete.

> **Educational use with fictional cases only. VoiceSBAR is not a medical device and is not approved for clinical
> use. Never enter real patient data.** Every report needs human review before anyone relies on it.

## What it does

1. **Dictate.** Hold the microphone button (or the <kbd>Space</kbd> key), speak Arabic, English or both, and let go.
   Speech recognition is done by [ElevenLabs Scribe v2](https://elevenlabs.io/speech-to-text). Arabic stays in
   Arabic script and English terms stay in English; nothing is translated. An optional AI step tidies up
   punctuation and is rejected automatically if it changes any word, number or term.
2. **Generate the SBAR report.** The notes go to Gemini in **one call** per report, with `store=false` and a fixed
   JSON schema. There is no automatic retry.
3. **Every line is backed by a quote.** Each statement in the report and each non-missing checklist entry must
   cite an exact quote from your notes. The server checks every quote against the notes (tolerating only
   whitespace and line-break differences). If any quote is not found, or the reply is incomplete or malformed, the
   report is **rejected** rather than shown (it fails closed).
4. **Review the flagged checklist.** Allergies, vital signs and when they were taken, history and reason for
   admission, medications, consciousness, pain, oxygen, lines and devices, and the plan are each marked as
   documented, partial, missing or unclear. A missing
   item is never assumed to be normal, and the Recommendation section never adds a new treatment plan.
5. **Copy, download or print** the report in the chosen language. A fixed, clearly labelled example works without
   any API key.

The app also keeps the VoiceScribe tabs: plain dictation, a personal vocabulary for drug names and other terms,
on-device history, settings, and an admin page with invite-only accounts and usage limits.

A matching quote does not prove that the model interpreted it correctly. Check numbers, medications, negations
and timings yourself.

## Tech stack

| Part | Technology | What it does |
| --- | --- | --- |
| Front end | React 19, TypeScript, Vite | The web interface, in Arabic (right to left) and English |
| Server | Hono on Cloudflare Pages Functions | The API: sign-in, transcription, SBAR reports, admin |
| Database | Cloudflare D1 | Accounts, sessions and usage limits only. No audio, notes or reports |
| Speech-to-text | ElevenLabs Scribe v2 | Turns spoken Arabic, English or both into text |
| SBAR report | Google Gemini (`gemini-3.5-flash-lite`) | One call per report with `store=false` and a fixed JSON schema |
| AI clean-up (optional) | Gemini's OpenAI-compatible endpoint | Fixes punctuation only; rejected if any word or number changes |
| Validation | Zod | Checks every request the server receives |
| Tests | Vitest, Testing Library | Server, SBAR-check and interface tests, with no network or keys |
| Tooling | Wrangler, ESLint, GitHub | Local server and deployment, code checks, source control |

## Run it locally

Requirements: Node.js 22.12 or newer.

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and fill in your own keys. Never commit this file or share its contents.

| Variable | What it is for |
| --- | --- |
| `ELEVENLABS_API_KEY` | Speech-to-text (ElevenLabs Scribe v2) |
| `GEMINI_API_KEY` | SBAR reports in the Handoff tab, from [Google AI Studio](https://aistudio.google.com/api-keys). Without it, only the fixed example works |
| `ADMIN_SETUP_CODE` | Any long random string; you enter it once in the app to create the first (admin) account |

**Optional AI clean-up with the same Gemini key.** Clean-up uses any OpenAI-compatible API, so you can point it at
Gemini's OpenAI-compatible endpoint. Add these lines to `.dev.vars`:

```ini
OPENAI_API_KEY=<your Gemini key>
ENHANCE_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
ENHANCE_MODEL=gemini-3.5-flash-lite
ENHANCE_REASONING_EFFORT=minimal
```

`ENHANCE_REASONING_EFFORT` must be `minimal` here: the default in `wrangler.toml` is `none`, which Gemini rejects.

**No keys, no cost.** The bundled mock providers stand in for ElevenLabs, the clean-up API and Gemini. Uncomment
the mock lines at the end of `.dev.vars`, then start them in their own terminal:

```bash
npm run mock:providers
```

**Start the app.** Build once so `dist/` exists, then run Vite with hot reload on http://localhost:5173 (the API
runs on port 8788 with a local D1 database):

```bash
npm run build
```

```bash
npm run dev
```

`npm run preview` instead builds and serves everything from http://localhost:8788 without hot reload.

| Command | What it does |
| --- | --- |
| `npm run check` | Lint, typecheck, all tests, production build (what CI runs) |
| `npm test` | Vitest: API tests on a local D1, SBAR checks, and UI tests in jsdom |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run db:migrate:local` | Apply database migrations locally |

Tests need no microphone, network or API keys: ElevenLabs, the clean-up API and Gemini are mocked. What still
needs a person is listed in [Manual testing](docs/MANUAL_TESTING.md).

## Privacy

- **Nothing is stored on the server:** no audio, no notes and no reports. The database holds only accounts,
  sessions and usage counts (durations and numbers of requests).
- **Audio goes to ElevenLabs** for transcription, and **notes go to Google** (Gemini) to build the report and,
  if you turn it on, for clean-up. Their own data policies apply.
- `store=false` means Gemini keeps no saved conversation for the app, but **free tiers may use the content you
  send to improve the providers' products.** This is one more reason to use fictional cases only.
- API keys live only in `.dev.vars` locally, or in Cloudflare secrets when deployed. History stays in your
  browser on your device.

See [Security](SECURITY.md) and [Architecture](docs/ARCHITECTURE.md) for details.

## Deploying

VoiceSBAR deploys to Cloudflare Pages the same way VoiceScribe does. Follow the
[Deployment guide](docs/DEPLOYMENT.md), with two differences: also add `GEMINI_API_KEY` as a Cloudflare secret, and
use a D1 database of its own. The default Pages project name is `voicesbar` (`voicesbar.pages.dev`); set the
`PAGES_PROJECT_NAME` repository variable to change it. The
[Admin guide](docs/ADMIN_GUIDE.md) covers invites, limits, password resets and cost control.

### Project layout

```
src/                 React + TypeScript UI (Vite)
  components/        HandoffPanel (SBAR), Dictate, History, Vocabulary, Settings, Admin, sign-in
server/              API (Hono) used by Cloudflare Pages Functions
  sbar.ts            SBAR prompt, schema, single Gemini call and quote checks
  routes/            sbar, dictation (transcribe/enhance/vocabulary), auth, admin
  elevenlabs.ts      Scribe v2 client; enhance.ts + verify.ts for clean-up and its safety check
functions/api/       Pages Functions entry point
shared/              types and validation rules used by both sides
migrations/          D1 schema
tests/               server/ and web/ tests
scripts/             mock ElevenLabs, OpenAI-compatible and Gemini server for local use
```

## Credits and licence

VoiceSBAR is built on two projects by Ibrahim Baabdullah:

- [VoiceScribe](https://github.com/ibrahimbaabdullah-jpg/VoiceScribe), the Arabic/English dictation website
  (React, Hono, Cloudflare Pages and D1).
- [Nursing SBAR Handoff Summarizer](https://github.com/ibrahimbaabdullah-jpg/nursing-sbar-handoff), the
  Python/Streamlit app whose prompt, schema and fail-closed checks were ported to `server/sbar.ts`.

SBAR follows [AHRQ's TeamSTEPPS definition](https://www.ahrq.gov/teamstepps-program/curriculum/communication/tools/sbar.html).

Licensed under [MIT](LICENSE). ElevenLabs, Google, Gemini, OpenAI and Cloudflare are trademarks of their owners;
this project is not affiliated with them or with AHRQ.

## نبذة عن المشروع

<div dir="rtl" lang="ar">

**VoiceSBAR** أداة تعليمية بالعربية (الافتراضية) والإنجليزية: تُملي ملاحظات تمريضية عن **حالة وهمية**، فتتحوّل إلى تقرير تسليم بصيغة **SBAR**: الوضع، الخلفية، التقييم، والتوصية، مع قائمة تنبّه إلى المعلومات الناقصة أو غير المكتملة.

> **للاستخدام التعليمي بحالات وهمية فقط. ليست جهازًا طبيًا وغير معتمدة للاستخدام السريري. يُمنع إدخال بيانات مرضى حقيقيين.** التقرير يحتاج مراجعة بشرية قبل الاعتماد عليه.

**كيف تشتغل؟**
1. **الإملاء:** اضغط مع الاستمرار على زر الميكروفون (أو مفتاح المسافة) وتكلّم بالعربي أو الإنجليزي أو بالاثنين، ثم اترك الزر. التحويل إلى نص يتم عبر ElevenLabs Scribe v2، بدون أي ترجمة. يمكن تفعيل تحسين علامات الترقيم بالذكاء الاصطناعي، ويُرفض تلقائيًا إذا غيّر أي كلمة أو رقم أو مصطلح.
2. **إنشاء التقرير:** تُرسل الملاحظات إلى Gemini في **استدعاء واحد فقط** لكل تقرير، مع `store=false`، وبدون إعادة تلقائية.
3. **كل سطر له اقتباس:** كل عبارة في التقرير مدعومة باقتباس حرفي من ملاحظاتك. يتحقق الخادم من كل اقتباس، وإذا لم يجد أحدها أو كان الرد ناقصًا **يُرفض التقرير بالكامل** ولا يُعرض.
4. **قائمة التنبيهات:** كل بند يُصنَّف مذكورًا أو غير مكتمل أو غير مذكور أو غير واضح: الحساسية، العلامات الحيوية ووقت قياسها، التاريخ المرضي وسبب الدخول، الأدوية، الوعي، الألم، الأكسجين، الأجهزة، والخطة. لا يُستنتج من غياب المعلومة أنها طبيعية، ولا يضيف قسم التوصية خطة علاجية جديدة.
5. **النسخ والتنزيل والطباعة** باللغة المختارة، ومثال وهمي ثابت يعمل بدون أي مفتاح.

**التقنيات المستخدمة:**

| الجزء | التقنية | وظيفتها |
| --- | --- | --- |
| الواجهة | React 19 وTypeScript وVite | واجهة الموقع بالعربية (من اليمين لليسار) والإنجليزية |
| الخادم | Hono على Cloudflare Pages Functions | واجهة البرمجة: تسجيل الدخول، التفريغ، تقارير SBAR، الإدارة |
| قاعدة البيانات | Cloudflare D1 | الحسابات والجلسات وحدود الاستخدام فقط، بدون صوت أو ملاحظات أو تقارير |
| تحويل الصوت إلى نص | ElevenLabs Scribe v2 | يحوّل الكلام بالعربي أو الإنجليزي أو بالاثنين إلى نص |
| تقرير SBAR | Google Gemini (`gemini-3.5-flash-lite`) | استدعاء واحد لكل تقرير مع `store=false` وصيغة JSON ثابتة |
| تحسين الترقيم (اختياري) | واجهة Gemini المتوافقة مع OpenAI | يصحّح الترقيم فقط، ويُرفض إذا تغيّرت أي كلمة أو رقم |
| التحقق من البيانات | Zod | يفحص كل طلب يصل إلى الخادم |
| الاختبارات | Vitest وTesting Library | اختبارات الخادم وفحص الاقتباسات والواجهة، بدون إنترنت أو مفاتيح |
| الأدوات | Wrangler وESLint وGitHub | التشغيل المحلي والنشر، فحص الكود، إدارة الشيفرة |

**التشغيل المحلي:** يتطلب Node.js 22.12 أو أحدث. نفّذ `npm install`، ثم انسخ `.dev.vars.example` إلى `.dev.vars` وضع فيه مفاتيحك: `ELEVENLABS_API_KEY` و`GEMINI_API_KEY` و`ADMIN_SETUP_CODE`. لتحسين الترقيم بمفتاح Gemini نفسه، أضف القيم الأربع الموضحة في قسم [Run it locally](#run-it-locally) (ومنها `ENHANCE_REASONING_EFFORT=minimal` لأن Gemini يرفض القيمة `none`). للتجربة بدون مفاتيح وبدون تكلفة شغّل `npm run mock:providers`. بعدها نفّذ `npm run build` مرة واحدة ثم `npm run dev`. لا ترفع ملف `.dev.vars` ولا تشارك محتواه.

**الخصوصية:**
- الخادم **لا يحفظ أي تسجيل صوتي ولا ملاحظات ولا تقارير**.
- الصوت يُرسل إلى ElevenLabs، والملاحظات تُرسل إلى Google (Gemini).
- الخطط المجانية قد تستخدم المحتوى المرسل لتحسين منتجات هذه الشركات، ولذلك استخدم حالات وهمية فقط.

**الشكر والرخصة:** مبني على مشروعين من إعداد إبراهيم باعبدالله: [VoiceScribe](https://github.com/ibrahimbaabdullah-jpg/VoiceScribe) و[مُلخِّص التسليم التمريضي](https://github.com/ibrahimbaabdullah-jpg/nursing-sbar-handoff). الرخصة MIT (مفتوح المصدر).

للتفاصيل: [دليل المستخدم](docs/USER_GUIDE.md) · [دليل النشر](docs/DEPLOYMENT.md) · [دليل المسؤول](docs/ADMIN_GUIDE.md)

</div>
