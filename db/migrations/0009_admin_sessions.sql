-- 0009: Administrator sessions.
--
-- 2026-10-03 product decision: the admin API requires a Google-authenticated
-- session for an allowlisted email (docs/admin-auth.md). A successful sign-in
-- creates one row here; the browser holds only the plaintext 32-byte random
-- token in an httpOnly cookie, and this table stores only its SHA-256 hex
-- digest — a database read never yields a usable session credential.
--
-- A session is valid while revoked_at IS NULL AND expires_at > now(). Logout
-- sets revoked_at; rows are never reused. This is operational state, not
-- domain history, so it is not append-only like audit_events.
--
-- Deliberately separate from share_tokens: a share token is a scoped public
-- bearer secret and never an administrator principal (AGENTS.md).

CREATE TABLE admin_sessions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash  text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email       text NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  CONSTRAINT admin_sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX admin_sessions_email_idx ON admin_sessions (email);
