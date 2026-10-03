// The whole API as one Vercel Function, served same-origin under /api
// (docs/deploy-vercel.md). vercel.json rewrites every /api/* request here;
// the handler strips the prefix and hands the request to Fastify. All logic
// lives in apps/api (src/vercel.ts), bundled into ./_api.mjs by
// `pnpm --filter @territorios/admin bundle:api` (see scripts/bundle-api.mjs
// for why it is a bundle and not a package import).
// Plain JavaScript on purpose: nothing here for Vercel to compile.
export { handler as default } from './_api.mjs';
