# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository. Include steps to reproduce and the impact. You should get a
reply within a week.

Never include real API keys, passwords or recordings in a report.

## Supported versions

Only the latest release on `main` receives fixes.

## What this project protects

- **API credits:** provider keys stay in Cloudflare secrets, sign-up is invite-only, and every transcription passes
  rate limits, per-user quotas and a site-wide budget before any provider is called.
- **Accounts:** passwords are stretched in the browser (PBKDF2-SHA256, 600k iterations) and stored server-side only
  as salted HMACs; sessions are random, hashed at rest, `HttpOnly`, `SameSite=Strict`, and revocable.
- **Content:** audio is streamed to ElevenLabs and never stored; transcripts are never stored on the server; history
  stays in the user's browser.
- **The page itself:** strict Content-Security-Policy with no third-party scripts, anti-framing, CSRF header and Origin
  checks.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-design).

## Out of scope

- Data handling by ElevenLabs, OpenAI or other providers you configure (see their policies).
- Anyone with access to the Cloudflare account, the GitHub repository settings, or an admin account.
- Physical access to an unlocked device with an open session or local history.
