/**
 * Skeleton landing page, framework-free per the stack decision.
 * The scoped, token-gated public territory view lands with the
 * public-web change (A6), which owns this app.
 */
export function mountLanding(root: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.textContent = 'Territory Management';

  const note = document.createElement('p');
  note.textContent = 'Public workspace skeleton. Shared territory views land with the public-web change.';

  root.replaceChildren(heading, note);
}
