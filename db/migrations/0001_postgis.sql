-- 0001: PostGIS extension.
-- Every geometry column in this schema is SRID 4326 (RFC 7946 WGS84), which
-- is the system of record for application-owned geometry (AGENTS.md).

CREATE EXTENSION IF NOT EXISTS postgis;
