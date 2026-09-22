-- 435_http_credentials.sql
-- Stored HTTP credentials for authenticated outbound webhooks (Webhook Output).
--
-- A user saves a header credential once ("the bot": header name + secret);
-- the node holds only the row's id (`data.credentialId`). The secret never
-- enters workflow JSON, an export, a template or a preset. The backend
-- encrypts the value with the instance key (AES-256-GCM,
-- backend/src/lib/instance-cipher.ts — the envelope social tokens and pasted
-- provider keys already use) and decrypts it at exactly one site
-- (backend/src/lib/http-credentials.ts :: resolveHttpAuthHeaders), at send
-- time, to attach it to the request.
--
-- Two kinds of row, one table (plan D1):
--   * PLAIN  — bound_url IS NULL. Usable only in a workflow that ONLY its
--              owner can run.
--   * BOUND  — bound_url names the https destination the credential may travel
--              to; bound_match says whether the node URL must equal it
--              ('exact': origin + path) or live under it ('prefix': same
--              origin, path prefix at a segment boundary). Required the moment
--              anyone else can run the workflow (published app, share for run).
--              Binding is a ratchet: it can be set or moved, never cleared.
--
-- SERVICE ROLE ONLY (the provider_credentials posture, migration 321, not the
-- social_connections one): RLS is enabled with NO policies and the API roles
-- hold no table privileges, so neither `anon` nor `authenticated` can read a
-- single row — not even the ciphertext — through PostgREST. Every access goes
-- through the backend routes (/v1/http-credentials, browser session only).
-- Do not add policies here. Proof: supabase/tests/http-credentials-privacy.behavior.sql.

CREATE TABLE IF NOT EXISTS public.http_credentials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Display name, unique per user ("Grok bot", "My CRM").
  name         TEXT NOT NULL,
  -- "header" today. No CHECK on purpose: adding "bearer" / "basic" later is a
  -- Zod change in the backend, not a migration. The backend Zod-parses the
  -- ROW on read and refuses an unknown kind rather than sending unauthenticated.
  auth_kind    TEXT NOT NULL,
  -- Per-kind settings; for "header": { "headerName": "Authorization" }.
  config       JSONB NOT NULL DEFAULT '{}',
  -- base64(iv || gcm-tag || ciphertext) of the secret value.
  ciphertext   TEXT NOT NULL,
  -- NULL = plain (see above); otherwise an https URL.
  bound_url    TEXT,
  -- 'exact' | 'prefix' — validated by the backend, no CHECK (same reason as auth_kind).
  bound_match  TEXT NOT NULL DEFAULT 'exact',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS http_credentials_user_id_idx ON public.http_credentials (user_id);

ALTER TABLE public.http_credentials ENABLE ROW LEVEL SECURITY;

-- Belt and braces on top of RLS-with-no-policies: the API roles have no table
-- privileges at all, so even a future permissive policy would not expose the
-- envelope through PostgREST.
REVOKE ALL ON TABLE public.http_credentials FROM anon, authenticated;

COMMENT ON TABLE public.http_credentials IS
  'Per-user HTTP credentials for Webhook Output (header name + AES-256-GCM encrypted secret, optional destination binding). Service role only; resolved at send time by the backend.';
COMMENT ON COLUMN public.http_credentials.bound_url IS
  'NULL = plain credential (owner-only workflows). Otherwise the https destination the credential may be sent to; see bound_match.';
COMMENT ON COLUMN public.http_credentials.bound_match IS
  '''exact'' = node URL must equal bound_url (origin + path); ''prefix'' = same origin and path under bound_url at a segment boundary.';
