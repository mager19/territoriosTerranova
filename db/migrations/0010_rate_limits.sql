-- Rate-limit counters shared by every API instance.
--
-- On Vercel the API runs as many short-lived function instances, so an
-- in-memory counter would give each instance its own allowance (five
-- sign-in attempts per IP per instance instead of five in total). The API's
-- @fastify/rate-limit store (apps/api/src/rate-limit/pg-store.ts) keeps one
-- fixed-window counter per limit key here instead, incremented atomically
-- with INSERT ... ON CONFLICT DO UPDATE.
--
-- Privacy (AGENTS.md): a limit key contains a client IP or a plaintext share
-- token, so only its SHA-256 hash is stored, never the key itself. Rows are
-- disposable: an expired row is reset on its next hit, and the API deletes
-- expired rows periodically.

CREATE TABLE rate_limit_counters (
  -- SHA-256 of the limit key, e.g. of 'admin-login:203.0.113.7'.
  key_hash   bytea PRIMARY KEY CHECK (octet_length(key_hash) = 32),
  -- Requests counted in the current window, the current one included.
  hits       integer NOT NULL CHECK (hits >= 1),
  -- When the current window ends and the counter starts again from 1.
  expires_at timestamptz NOT NULL
);

-- Serves the periodic DELETE ... WHERE expires_at < now() cleanup.
CREATE INDEX rate_limit_counters_expires_at_idx ON rate_limit_counters (expires_at);
