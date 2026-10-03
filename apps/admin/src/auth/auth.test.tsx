import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { App, AdminShell } from '../App.js';
import { ApiError, getMe, login, logout, onUnauthorized, listTerritories } from '../api/client.js';
import { authReducer } from './auth-state.js';
import { LoginScreen, loginErrorMessage } from './LoginScreen.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('login screen', () => {
  it('is what the app shows when the API reports no session', () => {
    const html = renderToStaticMarkup(<App initialAuth={{ status: 'anonymous' }} />);

    expect(html).toContain('Territorios — Administración');
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toMatch(/<button type="submit"[^>]*>Entrar<\/button>/);
    // No admin data UI is rendered before signing in.
    expect(html).not.toContain('aria-label="Vistas"');
    expect(html).not.toContain('<main');
  });

  it('shows neither the login card nor admin data while the session is being checked', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('Comprobando sesión…');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('aria-label="Vistas"');
  });

  it('renders the error message it is given', () => {
    const html = renderToStaticMarkup(
      <LoginScreen onSignedIn={() => undefined} initialError="Correo o contraseña incorrectos." />
    );
    expect(html).toMatch(/<p role="alert">Correo o contraseña incorrectos\.<\/p>/);
  });

  it('maps 401 and 429 to their sentences and never says which field was wrong', () => {
    expect(loginErrorMessage(new ApiError(401, 'invalid_credentials', 'x'))).toBe('Correo o contraseña incorrectos.');
    expect(loginErrorMessage(new ApiError(429, 'Too Many Requests', 'x'))).toBe('Demasiados intentos. Espera unos minutos.');
    expect(loginErrorMessage(new ApiError(0, 'network_error', 'x'))).toBe('No se pudo conectar con el servidor.');
  });
});

describe('signed-in shell', () => {
  it('shows the signed-in email and a "Cerrar sesión" button in the sidebar', () => {
    const html = renderToStaticMarkup(<AdminShell email="ana@example.org" onLogout={() => undefined} />);

    expect(html).toContain('ana@example.org');
    expect(html).toMatch(/<button[^>]*>Cerrar sesión<\/button>/);
    expect(html).toContain('aria-label="Vistas"');
  });

  it('is what the app shows once the API reports a session', () => {
    const html = renderToStaticMarkup(<App initialAuth={{ status: 'authenticated', email: 'ana@example.org' }} />);
    expect(html).toContain('ana@example.org');
    expect(html).not.toContain('type="password"');
  });
});

describe('auth state', () => {
  it('returns to the login screen on any 401, and after signing out', () => {
    const signedIn = authReducer({ status: 'checking' }, { type: 'signed_in', email: 'ana@example.org' });
    expect(signedIn).toEqual({ status: 'authenticated', email: 'ana@example.org' });
    expect(authReducer(signedIn, { type: 'unauthorized' })).toEqual({ status: 'anonymous' });
    expect(authReducer(signedIn, { type: 'signed_out' })).toEqual({ status: 'anonymous' });
  });

  it('resolves the initial check from GET /admin/me', () => {
    expect(authReducer({ status: 'checking' }, { type: 'checked', email: null })).toEqual({ status: 'anonymous' });
    expect(authReducer({ status: 'checking' }, { type: 'checked', email: 'ana@example.org' })).toEqual({
      status: 'authenticated',
      email: 'ana@example.org'
    });
  });
});

describe('API client and the session', () => {
  it('calls the API same-origin under /api, sending cookies', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { territories: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await listTerritories();

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/territories', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('notifies listeners when an admin request answers 401, then rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'unauthorized' })));
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);

    await expect(listTerritories()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await expect(listTerritories()).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('getMe returns the email, or null on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { email: 'ana@example.org' })));
    expect(await getMe()).toEqual({ email: 'ana@example.org' });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'unauthorized' })));
    expect(await getMe()).toBeNull();
  });

  it('login posts the credentials and a failed login does not count as a lost session', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, { error: 'invalid_credentials' }));
    vi.stubGlobal('fetch', fetchMock);
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);

    await expect(login('ana@example.org', 'wrong')).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/auth/login',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'ana@example.org', password: 'wrong' }) })
    );
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('logout posts to /api/admin/logout', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await logout();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/logout', expect.objectContaining({ method: 'POST' }));
  });
});
