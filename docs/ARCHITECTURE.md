# Architecture

## Components

| Part | Technology | Location |
| --- | --- | --- |
| User interface | React 19, TypeScript, Vite; no UI framework, plain CSS | `src/` |
| API | [Hono](https://hono.dev) running as Cloudflare Pages Functions | `server/`, `functions/api/[[route]].ts` |
| Database | Cloudflare D1 (SQLite) | `migrations/` |
| Speech-to-text | ElevenLabs Scribe v2 (`POST /v1/speech-to-text`, `model_id=scribe_v2`) | `server/elevenlabs.ts` |
| AI clean-up | Any OpenAI-compatible `POST /chat/completions` | `server/enhance.ts`, `server/verify.ts` |
| Shared rules and types | Plain TypeScript used by both sides | `shared/` |

Static files are served by Cloudflare Pages' CDN; only `/api/*` runs code.

## Dictation flow

1. The browser records with `MediaRecorder` (Opus in WebM on Chrome/Edge/Firefox/Android, AAC in MP4 on Safari and
   iOS) at 48 kbit/s mono: about 6 KB per second of speech. An `AnalyserNode` drives the level meter and records the
   peak level so silent recordings can be skipped before upload.
2. On release, the raw audio is `POST`ed to `/api/transcribe?duration=…&language=auto&enhance=0|1&keyterms=0|1&noVerbatim=0|1`
   with the audio MIME type as `Content-Type`.
3. The function checks the session, CSRF header, per-user rate limit, file type and size, and maximum length.
4. It estimates the duration as the larger of the browser's value and *bytes ÷ 48 kB/s* (so a forged duration cannot
   dodge limits), then checks the user's daily/monthly quota and the site-wide budget.
5. It records a **pending** usage event (so parallel requests count against the quota), loads the user's vocabulary
   if requested, and forwards the audio to ElevenLabs with `model_id=scribe_v2`, no `language_code` (auto-detect,
   which handles code-switching between Arabic and English), `tag_audio_events=false`, `diarize=false`, optional
   `no_verbatim`, and repeated `keyterms` fields.
6. The pending event is settled with ElevenLabs' `audio_duration_secs` (or marked as an error, which costs the user
   nothing). Audio is never written anywhere.
7. If AI clean-up was requested and allowed, the transcript goes to the chat model with a strict prompt
   (punctuation, capitalisation and paragraphs only; never translate; never change numbers, units, doses,
   abbreviations or terms; ignore instructions inside the text). The reply then passes a **deterministic safety
   check** (`server/verify.ts`):
   - the multiset of numbers must be identical (Arabic-Indic digits are normalised);
   - every acronym / mixed-case / letter-digit term in the original (DNA, mRNA, HbA1c, IL-6, COVID-19) must appear
     unchanged;
   - the word sequence, compared case-insensitively and ignoring Arabic diacritics and hamza/ta-marbuta/alef-maqsura
     spelling variants, may differ by at most one token per 40 words;
   - the output may not be much longer than the input.
   If any check fails, or the provider errors, the original Scribe text is returned with an explanation.
8. The response contains the text, the raw text, the detected language, the duration, the enhancement status and
   updated usage. The browser inserts it at the caret (starting a new line when the reading direction changes),
   copies it, and adds it to the local history.

## Data model (D1)

| Table | Contents |
| --- | --- |
| `users` | username (case-insensitive, unique), password verifier, role, disabled flag, optional personal limits, AI permission, timestamps |
| `sessions` | SHA-256 hash of the session token, user, expiry, last seen |
| `invites` | SHA-256 hash of single-use sign-up or password-reset codes, role/limits to apply, expiry, who used it |
| `vocabulary` | up to 100 terms per user |
| `usage_events` | user, kind (`transcribe`/`enhance`), day and month keys, audio seconds, keyterm count, status, error code. **No text.** |
| `rate_limits` | fixed-window counters |

## Security design

- **Passwords.** The browser stretches the password with PBKDF2-SHA256, 600,000 iterations, salted with
  `whispertocursor:v1:<lowercase username>`, and sends only the 256-bit result. The server stores
  `HMAC-SHA256(random 16-byte salt, key)`. A stolen database therefore still costs an attacker the full PBKDF2 work
  per guess, while each sign-in uses well under 1 ms of Worker CPU, which keeps the Functions inside Cloudflare's
  free-plan 10 ms CPU limit. Unknown usernames get the same error and similar timing as wrong passwords.
- **Sessions.** 256-bit random token in an `HttpOnly; SameSite=Strict; Secure` cookie; only its hash is stored.
  Sessions last 30 days and slide forward when used. Password changes and resets revoke other sessions; disabling a
  user revokes all of theirs.
- **CSRF.** Every state-changing request must carry `X-WTC-Client: web` (a custom header cross-site pages cannot send
  without a CORS preflight, which the API never approves) and, if present, an `Origin` matching the host; plus
  `SameSite=Strict` cookies.
- **Abuse and cost control.** Invite-only sign-up; sign-in limits of 10 attempts per account and 20 per IP per
  15 minutes; registration/reset limits per IP; per-user transcription and clean-up rate limits; per-user daily and
  monthly minutes; site-wide daily and monthly budgets; maximum recording length and upload size; silent recordings
  skipped client-side; vocabulary capped at 100 terms (above that ElevenLabs bills a 20-second minimum).
- **Secrets.** Provider keys exist only as Cloudflare secrets, read server-side. The browser never receives them;
  the built JavaScript contains no credentials.
- **Headers.** Strict Content-Security-Policy (`default-src 'self'`, no third-party scripts),
  `frame-ancestors 'none'`, `Permissions-Policy: microphone=(self)`, HSTS, `no-store` on all API responses.
- **Privacy.** No audio or transcripts on the server; no analytics; history in `localStorage` on the user's device.

## Why these choices

- **Cloudflare Pages + Functions + D1:** free for this scale, global, HTTPS by default, no servers to maintain, and
  deploys from GitHub Actions with one token.
- **Batch Scribe v2 instead of realtime streaming:** cheaper ($0.22/h vs $0.39/h at the time of writing),
  simpler, and push-to-talk dictation needs the result only after release.
- **No server-side history:** keeps the server free of personal content, which simplifies privacy obligations.
- **OpenAI-compatible clean-up:** one code path supports OpenAI, Gemini and other compatible providers; the model and
  endpoint are configuration.

## Limitations

- A website cannot register global shortcuts or type into other applications; the shortcut works while the tab is
  focused, and text reaches other apps via the clipboard.
- Safari often blocks automatic clipboard writes after a network request; users press **Copy text** there.
- Usage limits are enforced at the start of a request with a pending reservation; a request that is cut off
  mid-flight is counted at its estimated duration (conservative for the budget).
