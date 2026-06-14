# Security review

This is a static SPA hosted on Vercel that authenticates against a Supabase
backend. Each user has a single row in `public.user_data` holding their prices
and settings as JSONB.

Last full audit: 2026-06-10.

## Threat model in one paragraph

The realistic attackers are: (a) curious players who try to use the site
without an invite, (b) someone who finds a stale link to the site, (c) a
malicious-but-invited user who wants to read or tamper with another user's
data, (d) a supply-chain attacker who compromises one of our CDN dependencies.
There is no payment data, no chat, no PII beyond the email address used to
sign in.

## Defences in place

| Threat | Defence |
|---|---|
| Anyone-can-sign-up | **Public sign-up MUST be disabled** in Supabase: *Authentication → Sign In / Up → Allow new users to sign up = OFF*. Verify this on every Supabase project change. |
| Unauthenticated data scraping | The recipe dataset (`data.json`, `icons.json`) is the paid product. It is served from the **private** Supabase Storage bucket `recipe-data` (RLS grants `SELECT` to the `authenticated` role only) and fetched by `app.js` *after* sign-in. `.vercelignore` keeps the files off the CDN, so an anonymous `curl https://thealbioncalculator.com/data.json` returns 404 instead of the data. |
| Cross-user data read | RLS policy `auth.uid() = user_id` on `public.user_data` for select / insert / update. A logged-in user querying another user's row gets an empty result; a write is rejected by policy. |
| Stolen anon key | Anon keys are designed to be public — they cannot bypass RLS. The real protection is the RLS policies. |
| Session theft via XSS | Mitigated by minimising XSS surface (see below). Token stored in localStorage as `nendys.auth`. A successful XSS would steal it; without one, the token is inaccessible to other origins. |
| Clickjacking | `frame-ancestors 'none'` in the CSP (set as an HTTP header from `vercel.json`) plus `X-Frame-Options: DENY`. Site cannot be iframed. |
| Mixed content | All third-party loads use HTTPS. Vercel auto-redirects HTTP. |
| Supply-chain (CDN tampering) | Supabase JS pinned to a specific minor (`@supabase/supabase-js@2.45`). Other third-party CDN content (Google Fonts CSS, Albion render API) is style/image only and cannot execute JavaScript in this CSP. |
| Tampered localStorage / import file | `sanitizePrices` / `sanitizeSettings` whitelist material IDs and coerce all settings to known enum values / typed primitives before any value is rendered into HTML. |

## Recipe data delivery (private bucket)

The recipe JSON is **not** part of the public deploy. It lives in the private
Supabase Storage bucket `recipe-data` and is downloaded client-side only after
the user is authenticated:

- `auth.js` exposes `NendysData.loadJSON(name)`, which downloads via the
  authenticated Supabase client and caches each file in the Cache API keyed by
  the file's storage `updated_at` version. Unchanged files are not re-downloaded
  on revisits (saves Supabase egress; the dataset is multiple MB).
- `app.js` loads `data.json` + `icons.json` inside `initAppForUser`, after sign-in.
- `.vercelignore` excludes `data.json` / `icons.json` / `furniture.json` (and the
  `*.py` build tooling) from the Vercel deploy.

**Updating recipes (workflow change):** the JSON files stay in git as the source
of truth, but a redeploy no longer publishes them. After regenerating the data,
you must **re-upload the changed file(s) to the `recipe-data` bucket** (Storage →
`recipe-data` → upload, overwrite existing). The bucket's `updated_at` bumps the
client cache version automatically, so users pick up the new data on next load.
`furniture.json` is a *build-time* input only (merged into `data.json` by
`extract_recipes.py`); the client never fetches it, so it doesn't need uploading.

## Known limitations

- **JWT in localStorage.** Industry-standard for SPAs but means an XSS would be a session takeover. Defended by the CSP + sanitisers above. Not switching to httpOnly cookies because that would require a backend (we are static).
- **Concurrent device writes.** Last-write-wins via `upsert`. Two devices editing simultaneously will clobber each other. Acceptable for solo use.
- **Admin can read everyone's data.** Whoever holds the Supabase service-role key sees every `user_data` row. This is by design — only share that key with people you trust.
- **CSP allows `'unsafe-inline'` for styles.** Required by the Google Fonts CSS we import. Script `'unsafe-inline'` has been removed — image-error handling is now done via a delegated capture-phase listener (see top of `app.js`), and `<img>` tags use the `data-hide-on-error` attribute.

## Owner checklist (do these once on Supabase setup, re-check yearly)

- [ ] **Authentication → Sign In / Up → Allow new users to sign up = OFF**
- [ ] **Authentication → Providers → Email**: enabled, `Confirm email` = OFF
- [ ] **Authentication → Rate Limits**: token endpoint capped to ~5 attempts / minute / IP (mitigates brute-force & credential-stuffing)
- [ ] **Authentication → Attack Protection / CAPTCHA**: hCaptcha or Cloudflare Turnstile enabled on sign-in
- [ ] **SQL Editor**: ran the `user_data` table + RLS snippet from `README.md`
- [ ] **Database → Policies → public.user_data**: three policies present, all using `auth.uid() = user_id`
- [ ] **SQL Editor**: `revoke select on public.user_data from anon;` — only the `authenticated` role needs access, RLS does the rest
- [ ] **Storage → `recipe-data` bucket**: exists and is **private** (Public toggle OFF); contains the current `data.json` + `icons.json`
- [ ] **Storage → Policies**: a `SELECT` policy on `storage.objects` for the **`authenticated`** role only, `using ( bucket_id = 'recipe-data' )`; **no** `anon` policy
- [ ] **Project Settings → API**: anon key in `albion/config.js` is the *anon* key, never the service-role key

If you ever rotate the anon key, just paste the new one into `config.js` and redeploy. No code changes needed.

## Reporting issues

Found something off? Tell the admin in the Patreon Discord and DO NOT post a
proof-of-concept publicly until it's been confirmed and patched.
