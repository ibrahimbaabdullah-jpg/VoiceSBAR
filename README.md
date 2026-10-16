# VoiceScribe

**by Ibrahim Baabdullah · AI-Powered Speech-to-Text**

**Speak Arabic, English, or both in the same sentence, and get accurate text you can paste anywhere.**

🌐 **Live site: [voicescribe-ai.pages.dev](https://voicescribe-ai.pages.dev/)** (invite-only accounts)
· [العربية](#نبذة-عن-المشروع) · [Tech stack](#tech-stack)

VoiceScribe is a free, open-source dictation website. Hold a button (or a key), speak, let go, and the
transcript appears in an editor, ready to copy. Speech recognition is done by
[ElevenLabs Scribe v2](https://elevenlabs.io/speech-to-text). An optional AI step can tidy up punctuation.
It runs on Cloudflare's free tier and is meant for a small group of about 5–10 people.

- **Mixed Arabic and English:** languages are detected automatically, and Arabic stays in Arabic script while
  English terms stay in English. Nothing is ever translated.
- **Accurate terminology:** a personal vocabulary (ElevenLabs *keyterms*) helps with drug names, diseases, genes,
  statistics and other technical words.
- **Optional AI clean-up:** fixes punctuation, capitals and paragraphs through the OpenAI API (or any
  OpenAI-compatible API such as Gemini). A built-in safety check rejects the AI's version if it changed any
  word, number, abbreviation or technical term, and keeps the original transcript instead.
- **Push-to-talk or tap-to-toggle**, with a keyboard shortcut, a microphone picker, a live level meter, a timer
  and a clear recording indicator.
- **Editable text with correct right-to-left / left-to-right handling**: each paragraph follows its own language,
  or you can force RTL or LTR.
- **Copy Text** button, automatic copy after each dictation, and a fallback when the browser blocks clipboard access.
- **History** stored only on your device, plus download as `.txt`.
- **Works on computers, tablets and phones** (Chrome, Edge, Firefox, Safari, iOS and Android).
- **Invite-only accounts** with per-person daily and monthly minute limits, a site-wide budget cap, rate limiting,
  and an admin page with usage and an estimated monthly cost.
- **Private by design:** API keys live only in Cloudflare secrets. Audio is forwarded to ElevenLabs for
  transcription and never stored by this site. Transcripts are never stored on the server.

> **What a website can't do:** browsers do not let websites listen for keyboard shortcuts in other apps or type
> into other applications. VoiceScribe works while its tab is open and focused, and gives you the text to paste
> wherever you need it (one click on **Copy text**, or automatic copy, then <kbd>Ctrl</kbd>+<kbd>V</kbd> /
> <kbd>⌘</kbd>+<kbd>V</kbd>).

---

## For users

1. Open the site and choose **I have an invite code** (or open the invite link you were sent).
2. Pick a username and a password.
3. Allow the microphone when your browser asks.
4. **Hold** the big microphone button (or the <kbd>Space</kbd> key) while you speak, then let go.
5. The text appears in the editor and is copied. Paste it anywhere.

See the [User guide](docs/USER_GUIDE.md) (English and Arabic) for tips, settings and troubleshooting.

## For the site owner

Everything runs on accounts you control. Typical cost for 5–10 light users is **only the ElevenLabs usage**
(about **$0.22 per hour of audio** at the time of writing, plus about $0.05/hour when vocabulary is used). Cloudflare
Pages, Functions and D1 stay within the free tier at this scale, and AI clean-up costs fractions of a cent per use.

1. Fork or use this repository on GitHub.
2. Create a Cloudflare account, a D1 database and an API token.
3. Add three GitHub settings (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`). Every push to
   `main` then tests and deploys automatically.
4. Add your secrets in Cloudflare (`ELEVENLABS_API_KEY`, `ADMIN_SETUP_CODE`, and optionally `OPENAI_API_KEY`).
5. Open the site, enter the setup code once to create your admin account, and invite people from the **Admin** page.

The step-by-step [Deployment guide](docs/DEPLOYMENT.md) is written for non-developers. After that, see the
[Admin guide](docs/ADMIN_GUIDE.md) for invites, limits, password resets and cost control.

## How it works

```
Browser (React)                       Cloudflare Pages Functions (Hono)            Providers
───────────────                       ─────────────────────────────────            ─────────
MediaRecorder ── audio (webm/mp4) ──▶ /api/transcribe
                                       • session cookie check (D1)
                                       • rate limit + per-user/site quotas (D1)
                                       • forwards audio, never stores it ─────────▶ ElevenLabs Scribe v2
                                       • optional clean-up ───────────────────────▶ OpenAI-compatible API
                                       • safety check (numbers, terms, wording)
editor + copy ◀──── text + usage ──── • records only duration/counts (no text)
history in localStorage (this device only)
```

More detail in [Architecture](docs/ARCHITECTURE.md) and [Security](SECURITY.md).

## Development

Requirements: Node.js 22+.

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with your keys, or use the bundled mock providers so you need no keys and spend nothing:

```bash
npm run mock:providers
```

In a second terminal, build and run the site with the Functions and a local D1 database on http://localhost:8788:

```bash
npm run preview
```

For hot reload while working on the UI, `npm run dev` runs Vite on http://localhost:5173 with the API proxied to
`wrangler pages dev` on port 8788 (run `npm run build` once first so `dist/` exists).

| Command | What it does |
| --- | --- |
| `npm run check` | Lint, typecheck, all tests, production build (what CI runs) |
| `npm test` | Vitest: API integration tests on a real local D1 + UI tests in jsdom |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run db:migrate:local` | Apply database migrations locally |

All tests run without a microphone, network access or API keys: ElevenLabs and OpenAI are mocked, the database
is an in-memory D1 from Wrangler, and the browser's microphone and `MediaRecorder` are faked. What still needs a
human (real microphones, real API keys, real browsers and phones) is listed in
[Manual testing](docs/MANUAL_TESTING.md).

### Project layout

```
src/                 React + TypeScript UI (Vite)
  audio/recorder.ts  microphone capture, MIME selection, level meter
  components/        Dictate, History, Vocabulary, Settings, Admin, sign-in
server/              API (Hono) used by Cloudflare Pages Functions
  routes/            auth, dictation (transcribe/enhance/vocabulary), admin
  elevenlabs.ts      Scribe v2 client and error mapping
  enhance.ts         OpenAI-compatible clean-up; verify.ts is the safety check
functions/api/       Pages Functions entry point
shared/              types and validation rules used by both sides
migrations/          D1 schema
tests/               server/ (API + units) and web/ (UI) tests
scripts/             mock ElevenLabs/OpenAI server for local use
```

## Tech stack

| Area | Technologies |
| --- | --- |
| **Front end** | React 19, TypeScript, Vite, plain CSS (dark mode, responsive) |
| **Browser APIs** | MediaRecorder (audio capture), Web Audio (level meter, silence detection), Clipboard API, Web Crypto (password stretching), localStorage (on-device history) |
| **Back end** | Cloudflare Pages Functions, [Hono](https://hono.dev), Zod (request validation) |
| **Database** | Cloudflare D1 (SQLite): accounts, sessions, usage counters. No audio or transcripts |
| **Hosting** | Cloudflare Pages (free tier, HTTPS, global CDN) |
| **AI** | ElevenLabs Scribe v2 (speech-to-text, automatic Arabic/English detection); optional OpenAI-compatible API (OpenAI, Gemini) for punctuation clean-up |
| **Security** | PBKDF2-SHA256 in the browser + HMAC-SHA256 on the server, HttpOnly SameSite cookies, CSRF protection, rate limiting, strict Content-Security-Policy |
| **Quality** | Vitest (112 tests), Testing Library + jsdom, ESLint, Wrangler (local runtime) |
| **Automation** | GitHub Actions (CI on Linux, macOS and Windows; automatic deploy from `main`; tagged releases), Dependabot |
| **License** | MIT |

## نبذة عن المشروع

<div dir="rtl" lang="ar">

🌐 **رابط الموقع: [voicescribe-ai.pages.dev](https://voicescribe-ai.pages.dev/)** (الدخول بدعوة فقط)

**VoiceScribe** موقع مجاني ومفتوح المصدر لتحويل الكلام إلى نص. تكلّم بالعربي أو الإنجليزي أو بالاثنين في نفس الجملة، ويطلع لك النص جاهز تنسخه وتلصقه في أي مكان.

**كيف يشتغل؟** تضغط مع الاستمرار على زر الميكروفون (أو مفتاح المسافة) وتتكلم، وأول ما تترك الزر يتحوّل كلامك لنص ويُنسخ تلقائيًا.

**أهم المميزات:**
- يتعرّف تلقائيًا على **العربي والإنجليزي في نفس الجملة**، ويكتب العربي بالحروف العربية والمصطلحات الإنجليزية بالإنجليزي، **بدون أي ترجمة**.
- **قاموس شخصي** للمصطلحات العلمية والطبية (أسماء أدوية، أمراض، اختصارات) لرفع الدقة.
- **تحسين اختياري بالذكاء الاصطناعي** لعلامات الترقيم، مع فحص أمان يرفض أي تغيير في الكلمات أو الأرقام أو المصطلحات.
- محرّر نص يدعم **اليمين لليسار واليسار لليمين** تلقائيًا، وزر نسخ، وتنزيل الملف، وسجل محفوظ في جهازك فقط.
- يشتغل على **الكمبيوتر والتابلت والجوال**.
- **حسابات بالدعوة فقط**، مع حد يومي وشهري لكل شخص، وحد للموقع كامل، وصفحة إدارة تعرض الاستخدام والتكلفة التقريبية.
- **الخصوصية:** مفاتيح الخدمات محفوظة في Cloudflare فقط، والخادم **لا يحفظ أي تسجيل صوتي ولا أي نص**.

**التقنيات المستخدمة:**

| المجال | التقنيات |
| --- | --- |
| **الواجهة** | React 19، TypeScript، Vite، CSS (وضع ليلي وتصميم متجاوب) |
| **أدوات المتصفح** | MediaRecorder لتسجيل الصوت، Web Audio لمؤشر الصوت وكشف الصمت، Clipboard للنسخ، Web Crypto لتشفير كلمة المرور، localStorage لحفظ السجل في الجهاز |
| **الخادم** | Cloudflare Pages Functions، Hono، Zod للتحقق من البيانات |
| **قاعدة البيانات** | Cloudflare D1 (SQLite) للحسابات والجلسات وعدّاد الاستخدام، بدون أي صوت أو نصوص |
| **الاستضافة** | Cloudflare Pages (مجانية، HTTPS، شبكة عالمية) |
| **الذكاء الاصطناعي** | ElevenLabs Scribe v2 لتحويل الصوت لنص؛ واختياريًا OpenAI أو Gemini لتحسين علامات الترقيم |
| **الأمان** | تشفير كلمة المرور (PBKDF2 وHMAC-SHA256)، جلسات آمنة، حماية CSRF، تحديد عدد المحاولات، سياسة أمان صارمة للصفحة |
| **الجودة** | Vitest (112 اختبار)، Testing Library، ESLint، Wrangler |
| **الأتمتة** | GitHub Actions (اختبارات على Linux وmacOS وWindows، ونشر تلقائي)، Dependabot |
| **الرخصة** | MIT (مفتوح المصدر) |

للتفاصيل: [دليل المستخدم (عربي وإنجليزي)](docs/USER_GUIDE.md) · [دليل النشر](docs/DEPLOYMENT.md) · [دليل المسؤول](docs/ADMIN_GUIDE.md)

</div>

## Roadmap

- Arabic user interface.
- Optional desktop companion app (global hotkey and typing into the focused application), which a website
  cannot do.

## License

[MIT](LICENSE). ElevenLabs, OpenAI, Gemini and Cloudflare are trademarks of their owners; this project is not
affiliated with them.
