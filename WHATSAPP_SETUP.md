# MindVault WhatsApp Integration — Setup & Deployment Guide

Message your vault from your phone. Statements get saved as notes, questions get
RAG answers with sources — no commands to memorise, an LLM decides what you meant.

This works locally (via a tunnel) or in production (via your Render URL). Both are
covered below.

---

## Step 1: Create a Twilio Account and Join the Sandbox

1. Sign up at [twilio.com](https://twilio.com) — the free trial is enough.
2. Go to **Messaging → Try it out → Send a WhatsApp message**.
3. Twilio shows a sandbox number (e.g. `+1 415 523 8886`) and a join code like `join amber-tiger`.
4. From WhatsApp on your phone, send that exact join code to that number.
5. You should receive: *"Twilio Sandbox: ✅ You are all set!"*

> **Why the sandbox?** It's free, instant, and needs no Meta business verification.
> For personal use it works indefinitely. A production WhatsApp Business sender is
> only required to message people who haven't joined your sandbox.

---

## Step 2: Add Environment Variables

From **Twilio Console → Account Info**, copy your Account SID and Auth Token into `.env`:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=whatsapp:+14155238886
```

> **Never** put these in `.env.example` or `config.py` — both are tracked by git.
> Only `.env` is gitignored. The Auth Token both authorizes API calls and verifies
> inbound webhook signatures, so treat it as a password.

No database migration is needed — `users.phone_number` already exists in the schema.

---

## Step 3: Expose Your Backend

Twilio's servers must reach your app over public HTTPS. `localhost` won't work.

### Local development

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8000
```

It prints a URL like `https://spread-warrant-poet-fed.trycloudflare.com`. Leave it
running — the hostname changes on every restart.

### Production

Use your Render URL directly: `https://your-app.onrender.com`

Add the three `TWILIO_*` variables under **Environment** in the Render dashboard,
then save (this triggers a restart so they take effect).

---

## Step 4: Point Twilio at the Webhook

1. Go to **Messaging → Settings → WhatsApp Sandbox Settings**.
2. Set **When a message comes in**:
   - URL: `https://<your-domain>/whatsapp/webhook`
   - Method: **POST**
3. Click **Save**.

Signature verification is proxy-aware — it rebuilds the signed URL from
`X-Forwarded-Proto` / `X-Forwarded-Host`, so Render's and Cloudflare's TLS
termination won't break the HMAC check.

---

## Step 5: Link Your Phone Number

1. Open the dashboard (local: `http://localhost:5173`, or your Vercel URL).
2. Sign in, then go to **Settings → General → WhatsApp**.
3. Enter your number and click **Link**.
   - Country code is optional for 10-digit Indian numbers: `8955558388` → `+918955558388`
   - Spaces, dashes and brackets are all accepted

> **Why linking happens in the web app, not over WhatsApp:** your identity is already
> proven by the Firebase token there, so no OTP round trip is needed and an unknown
> number can never claim a vault. `phone_number` is `UNIQUE`, so auto-provisioning
> would let a wrong number permanently squat a real one.

Make sure you link on the deployment whose database you're testing against — local
and production may use different databases.

---

## Step 6: Test It

Open WhatsApp and message the sandbox number.

**Test the saving intent:**

> *"Remember: Java streams are lazy, terminal operations trigger evaluation"*

```
✅ Saved to your vault. I'm summarizing, tagging and linking it now.
```

**Test the search intent** (give the pipeline ~30 seconds first, so the note is embedded):

> *"What do I know about Java?"*

```
Your notes say Java streams are lazily evaluated — nothing runs until a
terminal operation is invoked...

*Sources:*
• Remember: Java streams are lazy…
```

**Rule of thumb:** statements save, questions search. If intent classification
fails, it defaults to search — reading your vault is always safe, writing to it
is not.

---

## How It Works

```
WhatsApp message
      ↓
Twilio POSTs to /whatsapp/webhook
      ↓
Verify X-Twilio-Signature (HMAC) ─── invalid ──► 403
      ↓ valid
Normalize From → look up users.phone_number
      ↓
  ┌───────────────┬──────────────────┐
  not linked          linked
      ↓                  ↓
setup instructions   return empty TwiML immediately
                     (satisfies Twilio's ~10s window)
                         ↓
                  background task:
                  intent classification
                         ↓
          ┌──────────────┴──────────────┐
      SAVE_NOTE                   SEARCH_OR_CHAT
   Note + pipeline              RAG agent (60s cap)
          └──── answer pushed via Twilio REST API ────┘
```

The webhook acknowledges instantly and does the AI work in the background because
embedding plus LLM synthesis routinely exceeds Twilio's ~10 second webhook window.

**Relevant files:**

| File | Role |
|---|---|
| `backend/routes/whatsapp.py` | Webhook endpoint, identity lookup, save/search branches |
| `backend/services/whatsapp.py` | Phone normalization, signature verification, outbound send |
| `backend/services/intent.py` | `SAVE_NOTE` vs `SEARCH_OR_CHAT` — shared with the Slack bot |
| `backend/routes/auth.py` | `POST /auth/phone`, `DELETE /auth/phone` |
| `frontend/src/components/SettingsModal.jsx` | The linking UI |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No reply at all | Tunnel down, or webhook URL wrong | `docker compose logs -f backend` — you should see the POST arrive |
| `403` in the logs | Twilio signed a different URL than the app sees | Confirm the console URL matches exactly: `https`, no trailing slash |
| *"This number isn't linked"* | Step 5 didn't take, or you linked on a different backend | `select email, phone_number from users;` in psql |
| Saves work, questions don't | Notes aren't embedded yet | Wait ~30s after saving, then ask again |
| First message after idle times out | Render free tier sleeps after 15 min | Send it again once the service wakes |

Watch it live while testing:

```bash
docker compose logs -f backend | grep -i whatsapp
```

---

## Limitations

- **Text only.** Attachments and voice notes get a polite "not supported yet" reply.
  Transcription already exists (`services/transcription.py`, used by `/api/notes/audio`),
  so this is a small addition when wanted.
- **Sandbox sessions expire** after 72 hours of inactivity — just re-send the join code.
- **One number per account.** `phone_number` is `UNIQUE`.
