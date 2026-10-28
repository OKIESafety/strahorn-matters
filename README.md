# Strahorn Matters

Private evidence journal: **Matter → Issue → Event → Evidence**.

- Phone-friendly web app (add to Home Screen) for manual entries with photos/screenshots.
- AI connector (MCP) so Claude or ChatGPT can search the matter and create events in batches.
- Original evidence is immutable (no edits, no deletes), SHA-256 hashed on upload, and every change is audit-logged.
- Roles: **Owner** (everything), **Contributor** (add events/evidence/notes), **Reviewer** (read + notes, e.g. attorney).

Stack: Next.js on Vercel, Supabase (Postgres, Auth, Storage, Row Level Security).

## One-time setup

### 1. Supabase
1. Run `supabase/migrations/0001_init.sql`: Supabase dashboard → **SQL Editor** → paste the file → **Run**.
2. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up". Accounts are only created by the owner inside the app.
3. **Authentication → Users → Add user**: create your own login (email + strong password, "Auto Confirm" on).
4. Enable MFA for your Supabase dashboard account (Account → Security).

### 2. Vercel
1. Import the GitHub repo as a new project (framework: Next.js, defaults are fine).
2. Add environment variables (Project → Settings → Environment Variables), copied from Supabase → Project Settings → API:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the anon / publishable key)
   - `SUPABASE_SERVICE_ROLE_KEY` (the service_role / secret key — mark Sensitive)
3. Deploy. Then in Supabase → Authentication → URL Configuration, set **Site URL** to the Vercel URL.

### 3. First use
1. Open the app, sign in, create the matter (e.g. "Strahorn Custody").
2. Settings → **Add someone**: add BreAnne as Contributor with a temporary password; she changes it under Account.
3. On the phone: Safari → Share → **Add to Home Screen**.

### 4. Connect Claude or ChatGPT
1. Settings → **AI connector** → Create connector URL. Copy it (shown once).
2. Claude: Settings → Connectors → Add custom connector → paste the URL.
   ChatGPT (Business, web): Settings → Connectors / Apps → create a custom MCP connector → paste the URL, no auth.
3. Ask: "List my matters in Strahorn Matters."

The URL contains a secret. Anyone with it acts as you. Revoke it in Settings if it leaks.

## Text exports (iMazing)
Export the conversation as **CSV** for just the new date range → upload on the Evidence page →
ask the AI to "process the latest text export". It reads the file with `read_evidence_text`, checks existing
events, and creates new ones with `create_events`, linking each to the export with the exact quote and row number.
Re-processing an overlapping export doesn't create duplicates (`source_key` + similarity check).

## AI tools
`list_matters`, `get_matter`, `search_events`, `get_events`, `create_issue`, `create_events` (batch ≤100),
`update_event`, `add_note`, `list_evidence`, `read_evidence_text`, `upload_evidence`, `attach_evidence`.

AI-created events default to **Needs review**; the timeline shows a banner until someone reviews them.
