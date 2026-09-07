export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
}

/** Matches docker-compose.yml defaults; a plain local setup needs no .env. */
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_DATABASE_URL = 'postgres://territorios:territorios@127.0.0.1:5432/territorios';

/**
 * Reads every environment variable the API actually consumes
 * (PORT, HOST, DATABASE_URL — see .env.example) and fails fast on
 * invalid input instead of silently binding to a wrong port.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const rawPort = env.PORT ?? String(DEFAULT_PORT);
  if (!/^\d+$/.test(rawPort)) {
    throw new Error(`PORT must be a plain integer, got: ${JSON.stringify(rawPort)}`);
  }
  const port = Number.parseInt(rawPort, 10);
  if (port < 1 || port > 65535) {
    throw new Error(`PORT must be between 1 and 65535, got: ${rawPort}`);
  }

  return {
    host: env.HOST ?? DEFAULT_HOST,
    port,
    databaseUrl: env.DATABASE_URL ?? DEFAULT_DATABASE_URL
  };
}
