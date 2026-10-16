# Deployment guide

This guide puts VoiceScribe online at an address like `https://voicescribe-ai.pages.dev`, with automatic
deployment every time an approved change lands on the `main` branch. You do not need to write code. Plan on
about 30 minutes.

You will create or use four accounts:

| Account | What for | Cost |
| --- | --- | --- |
| GitHub | Hosts the code and runs the automatic tests and deploys | Free |
| Cloudflare | Hosts the website, the API and the small database | Free tier is enough for 5–10 users |
| ElevenLabs | Speech-to-text (Scribe v2) | Pay for what you use (about $0.22 per audio hour) |
| OpenAI *(optional)* | AI clean-up of punctuation | A fraction of a cent per clean-up |

> **Keep keys secret.** API keys go only into Cloudflare (and the Cloudflare token only into GitHub's encrypted
> secrets). Never paste a key into a file in the repository, an issue, or a chat.

---

## 1. Get the code on GitHub

Fork this repository (or push it to your own repository). Everything below happens in **your** copy.

## 2. Create the Cloudflare database

1. Sign in at <https://dash.cloudflare.com>.
2. Open **Storage & Databases → D1 SQL Database → Create database**.
3. Name it `whispertocursor` and create it.
4. Copy the **Database ID** (a long code like `3f2a…-…`). You need it in step 4.

Command-line alternative: `npx wrangler d1 create whispertocursor`.

## 3. Create a Cloudflare API token for GitHub

1. In the Cloudflare dashboard, click your profile icon → **My Profile → API Tokens → Create Token →
   Create Custom Token**.
2. Name: `WhisperToCursor deploy`.
3. Permissions (both on **Account** level):
   - **Cloudflare Pages → Edit**
   - **D1 → Edit**
4. Account resources: include only your account. Create the token and copy it (it is shown once).
5. Also copy your **Account ID**: it is shown on the right side of the dashboard's account home page
   (or under **Workers & Pages → Overview**).

## 4. Tell GitHub how to deploy

In your GitHub repository go to **Settings → Secrets and variables → Actions**.

On the **Secrets** tab, add:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the token from step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account ID |

On the **Variables** tab, add:

| Name | Value |
| --- | --- |
| `D1_DATABASE_ID` | the database ID from step 2 |
| `PAGES_PROJECT_NAME` *(optional)* | defaults to `voicescribe-ai`; it becomes `<name>.pages.dev` |
| `SITE_URL` *(optional)* | your site address, shown as a link on each deployment |

The deploy job stays skipped until `D1_DATABASE_ID` exists, so nothing breaks before you finish.

## 5. First deployment

Go to **Actions → Deploy → Run workflow** (or push any commit to `main`). The workflow:

1. runs lint, typecheck, all tests and a production build on Linux, macOS and Windows;
2. creates the Cloudflare Pages project the first time;
3. applies the database migrations;
4. deploys the site.

When it is green, open `https://<project-name>.pages.dev`. The site loads, but transcription is not configured yet.

## 6. Add your secrets in Cloudflare

1. Get an ElevenLabs API key: <https://elevenlabs.io/app/settings/api-keys> → **Create API key**. If you can
   restrict permissions, it needs **Speech to Text** only. Setting a monthly credit limit on the key in
   ElevenLabs is a good extra safety net.
2. *(Optional)* Get an OpenAI API key: <https://platform.openai.com/api-keys>. Setting a monthly budget limit in
   your OpenAI organisation is recommended.
3. Choose an **admin setup code**: a long random phrase only you know, for example from a password manager
   (at least 20 characters).
4. In Cloudflare: **Workers & Pages → voicescribe-ai → Settings → Variables and Secrets → Add**. For each item,
   choose type **Secret** and environment **Production**:

| Secret name | Value |
| --- | --- |
| `ELEVENLABS_API_KEY` | your ElevenLabs key |
| `ADMIN_SETUP_CODE` | your setup code |
| `OPENAI_API_KEY` *(optional)* | your OpenAI key; leave it out to keep AI clean-up off |

5. Secrets take effect on the next deployment, so run **Actions → Deploy → Run workflow** again.

Command-line alternative: `npx wrangler pages secret put ELEVENLABS_API_KEY --project-name voicescribe-ai`.

## 7. Create your admin account

Open the site. It shows **Set up your site**. Enter your admin setup code, choose a username and a password. The
setup code works only while no admin exists, so it is useless afterwards (you may delete the secret).

Then open **Admin → Invite someone** to create invite codes or invite links for your users.

## 8. Only deploy approved changes

To make sure only reviewed changes go live:

1. **Settings → Branches → Add branch ruleset** (or *branch protection rule*) for `main`:
   - Require a pull request before merging, with at least 1 approval.
   - Require status checks to pass: select the **Lint, typecheck, test, build** check.
   - Block force pushes.
2. *(Optional)* **Settings → Environments → production → Required reviewers**: someone must click
   **Approve** before each deployment starts.

From then on: open a pull request → CI runs → a reviewer approves → merge → the site deploys itself.

## Optional settings

Non-secret settings live in [`wrangler.toml`](../wrangler.toml) under `[vars]`; change them with a pull request:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEFAULT_DAILY_LIMIT_MINUTES` | 30 | Per-person daily limit (change individuals on the Admin page) |
| `DEFAULT_MONTHLY_LIMIT_MINUTES` | 300 | Per-person monthly limit |
| `GLOBAL_DAILY_LIMIT_MINUTES` | 180 | Site-wide daily budget, across everyone |
| `GLOBAL_MONTHLY_LIMIT_MINUTES` | 1500 | Site-wide monthly budget (1500 min ≈ $5.50 at $0.22/h) |
| `MAX_RECORDING_SECONDS` | 300 | Longest single recording |
| `TRANSCRIBE_PER_MINUTE` | 10 | Rate limit per person |
| `ENHANCE_DAILY_LIMIT` | 200 | AI clean-ups per person per day |
| `ALLOW_KEYTERMS` | true | Allow personal vocabulary (adds an ElevenLabs keyterm charge) |
| `USAGE_TIME_ZONE` | UTC | When daily limits reset, e.g. `Asia/Riyadh` |
| `ELEVENLABS_BASE_URL` | `https://api.elevenlabs.io` | Use `https://api.eu.residency.elevenlabs.io` for EU data residency (requires an eligible ElevenLabs plan) |
| `ELEVENLABS_ZERO_RETENTION` | false | `true` asks ElevenLabs not to log requests; Enterprise accounts only |
| `ENHANCE_MODEL` | `gpt-6-luna` | Any chat model your provider offers |
| `ENHANCE_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint |
| `ENHANCE_REASONING_EFFORT` | `none` | Set to `""` if your model does not support `reasoning_effort` |
| `PRICE_AUDIO_PER_HOUR_USD`, `PRICE_KEYTERMS_PER_HOUR_USD` | 0.22, 0.05 | Only for the cost estimate on the Admin page |

**Using Gemini instead of OpenAI for clean-up:** set `ENHANCE_BASE_URL` to
`https://generativelanguage.googleapis.com/v1beta/openai`, `ENHANCE_MODEL` to a Gemini model such as
`gemini-3.1-flash-lite`, `ENHANCE_REASONING_EFFORT` to `""`, and put your Gemini API key in the
`OPENAI_API_KEY` secret.

## Custom domain

**Workers & Pages → your project → Custom domains → Set up a domain**. Cloudflare handles HTTPS. Browsers allow
the microphone only on HTTPS, which `*.pages.dev` and custom domains both provide.

## Updating, rolling back, and troubleshooting

- **Update:** merge changes into `main`; the site deploys itself. Database migrations run automatically.
- **Roll back:** Cloudflare → your project → **Deployments** → pick an earlier deployment → **Rollback**.
- **Deploy job skipped:** the `D1_DATABASE_ID` variable is missing.
- **"Authentication error" in the deploy log:** the API token is wrong or lacks *Pages: Edit* / *D1: Edit*, or the
  account ID is wrong.
- **"Transcription is not set up yet"** on the site: `ELEVENLABS_API_KEY` is missing, or you did not redeploy
  after adding it.
- **"ElevenLabs account is out of credits":** top up or upgrade in ElevenLabs. Users see a clear message
  meanwhile.
- **The setup page never appears:** an admin already exists. Use **Forgot password?** with a reset code from
  another admin. If you are the only admin and lost the password, see the [Admin guide](ADMIN_GUIDE.md).
- **Logs:** Cloudflare → your project → **Functions → Real-time logs**. Transcripts and audio are never logged.

## Preview deployments

Pull-request preview sites are deliberately not set up: they would share the production database and API keys.
Test changes locally with `npm run mock:providers` and `npm run preview` instead (see the README).
