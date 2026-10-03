// @vitest-environment happy-dom

/**
 * The auth gate end to end in a DOM, against the real API client with a
 * stubbed `fetch`: login screen on 401, sign-in, sidebar email, sign-out,
 * and the return to the login screen when a later request answers 401.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (url: string, init: RequestInit | undefined) => Response;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const calls: Array<{ url: string; method: string; body: string | undefined }> = [];

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  calls.length = 0;
  vi.unstubAllGlobals();
});

function stubApi(handler: Handler): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
      return handler(url, init);
    })
  );
}

async function mount(): Promise<void> {
  window.history.replaceState(null, '', '/territorios');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<App />));
  // Let the pending fetch promises settle.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function type(selector: string, value: string): Promise<void> {
  await act(async () => {
    const field = host?.querySelector(selector) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submitLogin(email: string, password: string): Promise<void> {
  await type('input[type="email"]', email);
  await type('input[type="password"]', password);
  await act(async () => {
    (host?.querySelector('form') as HTMLFormElement).requestSubmit();
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

function button(label: string): HTMLButtonElement | undefined {
  return [...(host?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === label);
}

describe('admin auth gate', () => {
  it('shows the login screen when GET /api/admin/me is 401, and fetches no admin data', async () => {
    stubApi(() => json(401, { error: 'unauthorized' }));
    await mount();

    expect(host?.textContent).toContain('Territorios — Administración');
    expect(host?.querySelector('input[type="password"]')).not.toBeNull();
    expect(calls.map((call) => call.url)).toEqual(['/api/admin/me']);
  });

  it('shows "Correo o contraseña incorrectos." for rejected credentials', async () => {
    stubApi((url) => (url === '/api/admin/auth/login' ? json(401, { error: 'invalid_credentials' }) : json(401, { error: 'unauthorized' })));
    await mount();
    await submitLogin('ana@example.org', 'wrong-password');

    expect(host?.querySelector('[role="alert"]')?.textContent).toBe('Correo o contraseña incorrectos.');
    expect(host?.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('shows "Demasiados intentos. Espera unos minutos." when rate-limited', async () => {
    stubApi((url) =>
      url === '/api/admin/auth/login'
        ? json(429, { statusCode: 429, error: 'Too Many Requests', message: 'Rate limit exceeded' })
        : json(401, { error: 'unauthorized' })
    );
    await mount();
    await submitLogin('ana@example.org', 'whatever-password');

    expect(host?.querySelector('[role="alert"]')?.textContent).toBe('Demasiados intentos. Espera unos minutos.');
  });

  it('signs in, shows the email in the sidebar, and signs out back to the login screen', async () => {
    let signedIn = false;
    stubApi((url) => {
      if (url === '/api/admin/auth/login') {
        signedIn = true;
        return json(200, { email: 'ana@example.org' });
      }
      if (url === '/api/admin/logout') {
        signedIn = false;
        return new Response(null, { status: 204 });
      }
      if (!signedIn) return json(401, { error: 'unauthorized' });
      if (url === '/api/admin/territories') return json(200, { territories: [] });
      return json(404, { error: 'not_found' });
    });
    await mount();
    await submitLogin('ana@example.org', 'correct-password');

    expect(calls.find((call) => call.url === '/api/admin/auth/login')?.body).toBe(
      JSON.stringify({ email: 'ana@example.org', password: 'correct-password' })
    );
    expect(host?.querySelector('.sidebar-account')?.textContent).toContain('ana@example.org');
    expect(host?.querySelector('input[type="password"]')).toBeNull();

    await act(async () => button('Cerrar sesión')?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(calls.some((call) => call.url === '/api/admin/logout' && call.method === 'POST')).toBe(true);
    expect(host?.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('returns to the login screen when any later API request answers 401 (session expired or revoked)', async () => {
    stubApi((url) => {
      if (url === '/api/admin/me') return json(200, { email: 'ana@example.org' });
      // The session ends between the check and the territory list fetch.
      return json(401, { error: 'unauthorized' });
    });
    await mount();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(calls.map((call) => call.url)).toContain('/api/admin/territories');
    expect(host?.querySelector('.sidebar-account')).toBeNull();
    expect(host?.querySelector('input[type="password"]')).not.toBeNull();
  });
});
