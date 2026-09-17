# ChatHub

Static front-end (`index.html` + `app.js` + `style.css`) that talks straight to Supabase.

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
