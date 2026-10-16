# Testing

## What is automated (`npm test`, run by CI on Linux, macOS and Windows)

**API (`tests/server`)**: the real Hono app against a real local D1 database (Wrangler's platform proxy), with
ElevenLabs and OpenAI replaced by a mocked `fetch`:

- first-run admin setup (only once), invites (single use, expiry, loose typing of codes), duplicate usernames,
  sign-in, identical errors for unknown users and wrong passwords, sign-in rate limiting and its reset, session
  expiry and sliding renewal, sign-out (old cookie rejected), CSRF header and Origin checks, oversized bodies;
- password change (other devices signed out), admin-issued reset codes (bound to one account, single use);
- admin permissions, disabling (sessions revoked), last-admin protection, limits, deletion, invite revocation,
  usage overview and cost estimate, and that no transcript text is ever stored;
- transcription: the exact request sent to Scribe v2 (model, auto language, language hint, `no_verbatim`, repeated
  `keyterms`, zero-retention flag, EU base URL), upload validation before any spend, daily/monthly/site quotas
  (including a forged duration), per-user rate limit, and mapping of ElevenLabs errors (402 credits, legacy
  `quota_exceeded`, 401 key, 429 busy, 400 short/invalid audio, 5xx, network failure); failed calls not counted;
- AI clean-up: request shape (model, `reasoning_effort`, prompt), applied result, rejection when a number changes,
  rejection of translated mixed Arabic/English text, provider out-of-credits fallback, missing key, per-user switch,
  daily clean-up limit, Gemini-compatible endpoint;
- vocabulary validation (ElevenLabs limits, duplicates, 100-term cap);
- unit tests for the safety check, tokenizer, crypto helpers, code generation, config parsing, time zones, and the
  browser password stretching (checked against Node's PBKDF2).

**UI (`tests/web`)**: React in jsdom with a fake microphone, fake `MediaRecorder` and a fake API:

- sign-in (only the stretched key is sent, never the password), first-run setup, invite links, password mismatch;
- hold-to-talk end to end (request parameters, insertion, auto-copy, history, usage, microphone released),
  appending, undo, accidental taps, silent recordings and *Send anyway*, failure with **Retry** re-sending the same
  audio, quota messages, blocked microphone, keyboard shortcut (and not while typing), tap-to-toggle, AI clean-up flag,
  copy fallback when the clipboard is blocked, RTL/LTR switching;
- vocabulary page validation and saving, history copy and reuse, admin-only tab, invite creation.

**Checked by hand during development** (Chromium, local Pages Functions + D1 + `scripts/mock-providers.mjs`):
first-run setup, recording with a synthetic microphone through the real `MediaRecorder`, Arabic/English text
rendered right-to-left with embedded English, vocabulary sent as 3 keyterms, AI clean-up applied, invite creation,
desktop and 375 px phone layouts with no horizontal scrolling.

## What still needs a person

These need real hardware, real accounts or real money, so they cannot run in CI. Please go through them after the
first deployment and after major changes.

### With real API keys

- [ ] Dictate a mixed Arabic/English sentence with medical terms. Arabic stays in Arabic script, English terms stay
      in English, nothing is translated.
- [ ] Dictate numbers and doses ("five milligrams", "7.2 percent") in both languages and check them.
- [ ] Add 3–5 vocabulary terms that were misrecognised and confirm they now come out right.
- [ ] Turn on AI clean-up: punctuation improves and no words change. Then, in the editor, use
      **Improve punctuation (AI)**.
- [ ] Watch the Admin overview update and compare with the ElevenLabs usage page after a day.
- [ ] Temporarily set an invalid `ELEVENLABS_API_KEY` and redeploy: users see "the site's ElevenLabs API key was
      rejected". Restore it.
- [ ] (Optional) With an exhausted or tiny-credit ElevenLabs key, users see the out-of-credits message.

### Real browsers and devices

| Browser / device | Record (hold) | Record (toggle) | Auto-copy | Copy button | Mic picker | RTL text |
| --- | --- | --- | --- | --- | --- | --- |
| Chrome (Windows) | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Edge (Windows) | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Firefox (Windows or Linux) | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Safari (macOS) | [ ] | [ ] | expected to fall back to the Copy button | [ ] | [ ] | [ ] |
| Chrome (macOS) | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Safari (iPhone/iPad) | [ ] | [ ] | expected to fall back | [ ] | n/a | [ ] |
| Chrome (Android) | [ ] | [ ] | [ ] | [ ] | n/a | [ ] |

Also check:

- [ ] First permission prompt, then denying the microphone shows the help message; re-allowing works.
- [ ] Unplugging the selected microphone falls back to the default one.
- [ ] Holding the button on a phone does not select text or open a context menu.
- [ ] Switching tabs or apps while holding the key stops the recording (no stuck recording).
- [ ] Airplane mode while transcribing shows the offline message and **Retry** works afterwards.
- [ ] A 5-minute recording stops automatically and is transcribed.
- [ ] "Keep the microphone ready" makes the first word come through; turning it off releases the microphone indicator.
- [ ] Add to Home Screen on iOS/Android opens the app full screen.
- [ ] Screen reader (VoiceOver or NVDA): the record button announces its state; notices are read out.

### Deployment pipeline

- [ ] A pull request runs CI on all three operating systems.
- [ ] Merging to `main` runs CI, applies migrations and deploys; the site shows the change.
- [ ] With branch protection on, a pull request cannot be merged without approval and passing CI.
- [ ] Rollback from the Cloudflare dashboard works.
- [ ] The response headers on the live site include the Content-Security-Policy from `public/_headers`.
