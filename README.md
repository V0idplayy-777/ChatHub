# ChatHub

Static front-end (`index.html` + `app.js` + `style.css`) that talks straight to Supabase.

## Features added in this branch

- **Hardcoded system prompt** — always sent as the first `system` message to `groq-chat` (see `SYSTEM_PROMPT` in `app.js`).
- **Light / dark theme** — Lucide sun/moon toggle fixed at the top-right. Light is the default; choice is saved in `localStorage` under `chathub-theme`.
- **Cloudflare image generation** — image button in the composer calls Cloudflare Workers AI (Flux). Configure credentials below before using it.

## Accounts: username + password, no email

There is no email field and no email verification step. A user picks a username
(3–20 chars, `a–z 0–9 . _`, must start and end with a letter or number) and a
password of at least 6 characters.

Supabase Auth still requires an email-shaped identifier, so the app derives a
private one from the username — `kai_99` becomes `kai_99@chathub.local`. That
address is never shown, never collected and never mailed to; it exists purely so
`auth.uid()`, the row-level security policies and the existing `accounts`,
`groups` and `admin_messages` tables keep working unchanged. Username uniqueness
comes free from the unique index Supabase keeps on auth emails.

The username is also stored in the auth user metadata as `name` and `username`,
so whatever trigger creates `accounts` rows picks it up as the display name.

### One-time project setting (required)

Username sign-up needs **email confirmation turned off**, otherwise Supabase
hands back a user with no session and nobody can ever confirm it:

> Supabase dashboard → **Authentication** → **Sign In / Providers** → **Email**
> → switch **Confirm email** to **OFF** → Save.

The app checks `GET /auth/v1/settings` before signing anyone up. While that
switch is still on, sign-up is refused with a message naming the setting, so no
half-created accounts pile up. The check is re-run on every failed attempt, so
the next sign-up works as soon as the switch is flipped — no page reload needed.

### Trade-off

With no email address there is no password reset and no account recovery. An
admin can still ban, unban, promote and demote users from the Admin Panel.

### Older accounts

Accounts created before this change signed up with a real email address. They
keep working: the sign-in box accepts a full email address as well as a
username, and such users still see their stored display name.

## Theme switcher

A floating button in the top-right corner (Lucide sun / moon icons) toggles
`data-theme="light|dark"` on `<html>`. Preference is read on every page load
(before paint, via a tiny inline script in `index.html`) and written to
`localStorage` key `chathub-theme`. Default is **light**.

## System prompt

`SYSTEM_PROMPT` in `app.js` is hardcoded and prepended to every chat request:

```js
const history = [
  { role: 'system', content: SYSTEM_PROMPT },
  ...recentMessages
];
```

Edit that constant to change the assistant's personality / rules. It is never
shown in the UI and is not user-editable.

## Cloudflare image generation

ChatHub can generate images from a text prompt using **Cloudflare Workers AI**
(model `@cf/black-forest-labs/flux-1-schnell` by default).

Type a description in the composer and click the **image** button (left of send).

### Option A — Worker proxy (recommended)

Keeps your API token off the public frontend.

1. Create a free [Cloudflare](https://dash.cloudflare.com/) account.
2. Install the CLI and log in:
   ```bash
   npm i -g wrangler
   wrangler login
   ```
3. Create a new Worker project:
   ```bash
   npm create cloudflare@latest chathub-image -- --type=hello-world
   cd chathub-image
   ```
4. In `wrangler.toml` / `wrangler.jsonc`, add an AI binding:
   ```toml
   name = "chathub-image"
   main = "src/index.js"
   compatibility_date = "2024-09-01"

   [ai]
   binding = "AI"
   ```
5. Replace `src/index.js` with the Worker in
   [`worker/src/index.js`](worker/src/index.js) from this repo (it picks the
   right steps field per model family and retries without optional fields if a
   model schema changes). A ready-made config is
   [`worker/wrangler.jsonc`](worker/wrangler.jsonc) — keep the worker `name`
   matching your deployment so `wrangler deploy` updates it in place.

6. Deploy:
   ```bash
   wrangler deploy
   ```
   Copy the printed URL, e.g. `https://chathub-image.<you>.workers.dev`.

7. In `app.js`, set:
   ```js
   const CF_IMAGE_WORKER_URL = 'https://chathub-image.<you>.workers.dev';
   ```
   Leave `CF_ACCOUNT_ID` / `CF_API_TOKEN` empty.

8. (Optional but recommended) Lock CORS to your real ChatHub origin instead of `*`,
   and add a shared secret header that only your app sends.

### Option B — Direct REST call (quick local demo only)

Exposes the token in the browser — **do not use in production**.

1. Cloudflare Dashboard → **Workers & Pages** → **Workers AI** → enable if prompted.
2. Dashboard → manage account → **Account ID** (right sidebar) → copy it.
3. **My Profile** → **API Tokens** → **Create Token** → use the
   **Edit Cloudflare Workers** template, or a custom token with
   **Account → Workers AI → Edit**.
4. In `app.js`:
   ```js
   const CF_ACCOUNT_ID = 'your_account_id';
   const CF_API_TOKEN  = 'your_api_token';
   // leave CF_IMAGE_WORKER_URL = ''
   ```

### Notes

- Free Workers AI has daily neuron limits; Flux Schnell is cheap (~a few neurons / image).
- Workers AI validates inputs against each model's strict schema
  (`additionalProperties: false`). The diffusion-steps field name depends on
  the model family: **FLUX takes `steps`** (integer, max 8, default 4) while
  the **Stable Diffusion family takes `num_steps`** (max 20). Sending the
  wrong name fails with error 5006
  (`Additional or unevaluated properties '/num_steps' at '/' not allowed`).
  The Worker in `worker/` picks the right name per model and retries with just
  the prompt if a schema ever rejects the optional field.
- Generated images are stored as data-URLs in the chat message. Very large images
  may fail to persist to Supabase row size limits — they still show for the session.
- Change the model with `CF_IMAGE_MODEL` (e.g. `@cf/stabilityai/stable-diffusion-xl-base-1.0`).

Official docs: https://developers.cloudflare.com/workers-ai/
