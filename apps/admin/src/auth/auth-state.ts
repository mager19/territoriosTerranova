/**
 * Which top-level screen the admin app shows. The API is the only
 * authority: `checking` until GET /admin/me answers, `anonymous` after any
 * 401 (from /me or from any other admin request), `authenticated` with the
 * email the API reported.
 */

export type AuthState =
  | { readonly status: 'checking' }
  | { readonly status: 'anonymous' }
  | { readonly status: 'authenticated'; readonly email: string };

export type AuthEvent =
  | { readonly type: 'checked'; readonly email: string | null }
  | { readonly type: 'signed_in'; readonly email: string }
  | { readonly type: 'signed_out' }
  | { readonly type: 'unauthorized' };

export function authReducer(_state: AuthState, event: AuthEvent): AuthState {
  switch (event.type) {
    case 'checked':
      return event.email === null ? { status: 'anonymous' } : { status: 'authenticated', email: event.email };
    case 'signed_in':
      return { status: 'authenticated', email: event.email };
    case 'signed_out':
    case 'unauthorized':
      return { status: 'anonymous' };
  }
}
