# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-16

First release: WhisperToCursor as a website.

### Added

- Browser dictation with hold-to-talk and tap-to-toggle, an in-page keyboard shortcut, microphone selection and
  test, live level meter, timer, recording indicator and Esc to discard.
- ElevenLabs Scribe v2 transcription with automatic language detection for mixed Arabic and English, optional
  language hint and filler-word removal.
- Personal vocabulary (ElevenLabs keyterms) with validation and a clear extra-cost notice.
- Optional AI clean-up through any OpenAI-compatible API (default `gpt-6-luna`), protected by a deterministic check
  that keeps the original transcript if numbers, terms or wording change.
- Editable text with per-paragraph right-to-left/left-to-right handling, Copy button with fallback, automatic copy,
  undo, `.txt` download, and on-device history.
- Invite-only accounts, admin page (invites, limits, password-reset codes, disable/delete, usage and cost
  estimate), per-user daily/monthly limits, site-wide budget, rate limiting, CSRF protection, strict security
  headers.
- Cloudflare Pages Functions API with D1, GitHub Actions CI on Linux/macOS/Windows, automatic deployment from
  `main`, tagged releases, mock providers for local development, and documentation.

[0.1.0]: https://github.com/ibrahimbaabdullah-jpg/WhisperToCursor/releases/tag/v0.1.0
