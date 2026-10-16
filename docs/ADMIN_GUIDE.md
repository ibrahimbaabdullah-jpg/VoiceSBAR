# Admin guide

Admins see an extra **Admin** tab. Everything below happens there unless noted.

## Inviting people

1. **Admin → Invite someone.** Optionally add a note (who it is for), a role, and personal daily/monthly limits
   (leave blank to use the site defaults). Codes expire after 7 days by default (1–30).
2. Click **Create invite code**. The code is shown **once**. Send either the code or the **invite link**
   (it opens the sign-up form with the code filled in) through a private channel.
3. The person chooses their own username and password. Each code works one time.

Unused codes are listed under **Codes** and can be revoked.

## Limits and costs

Each person has a **daily** and a **monthly** limit in minutes of audio. On top of that, the whole site has a
daily and monthly budget (`GLOBAL_DAILY_LIMIT_MINUTES`, `GLOBAL_MONTHLY_LIMIT_MINUTES` in `wrangler.toml`), so the
total bill cannot run away even if several people dictate a lot.

- Change one person's limits with **Limits** next to their name. Leave a box empty to return to the default.
  Setting `0` blocks transcription for that person.
- Limits are checked **before** audio is sent to ElevenLabs, so a request over the limit costs nothing.
- Recordings that fail at ElevenLabs do not count against anyone's minutes.
- Silent recordings are not sent at all (unless the user chooses *Send anyway*).
- The **Overview** shows minutes used today and this month and an **estimated** ElevenLabs cost based on the
  prices in `wrangler.toml`. Your ElevenLabs usage page is the authoritative bill.

**Extra charges to know about**

| Feature | Charge | How to control it |
| --- | --- | --- |
| Personal vocabulary (keyterms) | ElevenLabs adds about $0.05 per audio hour (≈ +20%) to recordings that use it | Users can switch it off; you can disable it site-wide with `ALLOW_KEYTERMS = "false"` |
| AI clean-up | Your OpenAI (or Gemini) bill, typically well under a cent per use | Leave `OPENAI_API_KEY` unset to disable it; **Turn AI off** per person; `ENHANCE_DAILY_LIMIT` |

Vocabularies are capped at 100 terms per person because ElevenLabs bills a 20-second minimum per request when more
than 100 keyterms are sent.

Also set spending limits at the providers themselves (ElevenLabs API key credit limit, OpenAI organisation budget).

## Managing people

| Button | What it does |
| --- | --- |
| **Limits** | Personal daily/monthly minutes |
| **Turn AI off / on** | Allow or block AI clean-up for this person |
| **Reset password** | Creates a one-time reset code (valid 3 days). Send it privately; the person uses **Forgot password?** on the sign-in page. All their devices are signed out when they reset. |
| **Disable / Enable** | A disabled person is signed out everywhere and cannot sign in |
| **Make admin / Make user** | Admins can invite and manage everyone |
| **Delete** | Removes the account, its sessions and vocabulary. Their past minutes still count toward the site totals. |

You cannot disable, demote or delete yourself, and the site always keeps at least one active admin.

## If the only admin loses their password

Another admin can issue a reset code. If there is no other admin:

1. Cloudflare dashboard → **Storage & Databases → D1 → whispertocursor → Console**.
2. Run (replace the name): `UPDATE users SET role = 'user' WHERE username = 'your-admin-name';`
3. Make sure the `ADMIN_SETUP_CODE` secret still exists (add it again and redeploy if you deleted it).
4. Open the site: the **Set up your site** page appears again. Create a new admin account with the setup code.
5. From the new admin account, issue a **Reset password** code for your old account and **Make admin** again.

## Rotating API keys

Create the new key at the provider, replace the secret in Cloudflare (**Settings → Variables and Secrets**),
redeploy (**Actions → Deploy → Run workflow**), then delete the old key at the provider.

## Privacy reminders

- The server stores usernames, password verifiers (never passwords), sessions, vocabularies, and usage counts
  (duration, time, success/failure). It never stores audio or transcripts.
- Audio is sent to ElevenLabs for transcription, and text to OpenAI only when AI clean-up is used. Their data
  policies apply. ElevenLabs Enterprise customers can enable zero retention with `ELEVENLABS_ZERO_RETENTION`.
- History is kept only in each person's browser. Remind people using shared computers to use
  **Settings → Sign out and clear this device's history**.
