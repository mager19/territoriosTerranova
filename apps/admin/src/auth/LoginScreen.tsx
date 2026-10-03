import { useState, type FormEvent, type JSX } from 'react';

import { ApiError, describeApiError, login as loginRequest } from '../api/client.js';

/**
 * Sign-in card shown whenever the API answers 401 (docs/admin-auth.md).
 * The API decides everything; this only collects the two fields and maps
 * the outcome to a sentence. It never says which field was wrong.
 */

export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Correo o contraseña incorrectos.';
    if (error.status === 429) return 'Demasiados intentos. Espera unos minutos.';
    return describeApiError(error);
  }
  return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}

export interface LoginScreenProps {
  readonly onSignedIn: (email: string) => void;
  /** Injected for tests; defaults to the real API call. */
  readonly login?: (email: string, password: string) => Promise<{ email: string }>;
  /** Initial error, e.g. for rendering the error state statically in tests. */
  readonly initialError?: string | null;
}

export function LoginScreen({ onSignedIn, login = loginRequest, initialError = null }: LoginScreenProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(email, password);
      setPassword('');
      onSignedIn(result.email);
    } catch (caught) {
      setError(loginErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={(event) => void handleSubmit(event)} aria-labelledby="login-title">
        <h1 id="login-title" className="login-title">
          Territorios — Administración
        </h1>
        <label htmlFor="login-email">Correo electrónico</label>
        <input
          id="login-email"
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="login-password">Contraseña</label>
        <input
          id="login-password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error !== null && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
