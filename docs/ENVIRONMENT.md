# SignupAssist Environment Management

Environment variables are managed from one source of truth:

- Registry: `scripts/envRegistry.ts`
- Doctor CLI: `scripts/envDoctor.ts`
- Template: `.env.example`

The goal is to stop hand-copying scattered variable lists. Update the registry first, then use the commands below to check or generate the target-specific files you need.

## Quick Start

Create local env once:

```bash
cp .env.example .env
npm run env:check -- --target=local
```

Check a production target before deploy:

```bash
npm run env:check -- --target=railway-web --strict
npm run env:check -- --target=railway-worker --strict
npm run env:check -- --target=supabase-functions --strict
```

List what a target needs without values:

```bash
npm run env:list -- --target=railway-web
npm run env:list -- --target=railway-worker
npm run env:list -- --target=supabase-functions
```

Generate ignored dotenv files from your current `.env`:

```bash
npm run env:write -- --target=railway-web --out=.env.railway-web.generated
npm run env:write -- --target=railway-worker --out=.env.railway-worker.generated
npm run env:write -- --target=supabase-functions --out=.env.supabase.generated
```

Those files are ignored by git because `.env.*` is ignored. They can contain secrets.

## How To Use Generated Files

Railway web service:

1. Run `npm run env:write -- --target=railway-web --out=.env.railway-web.generated`.
2. Open the Railway web service variables editor.
3. Use the raw/bulk editor if available, or paste the generated file values in one pass.
4. Run `npm run env:check -- --target=railway-web --strict` locally before deploy.

Railway worker service:

1. Run `npm run env:write -- --target=railway-worker --out=.env.railway-worker.generated`.
2. Apply those values to the worker service.
3. The worker only needs the subset required to read Supabase, call the provider, and execute scheduled registrations.

Supabase Edge Functions:

```bash
npm run env:write -- --target=supabase-functions --out=.env.supabase.generated
supabase secrets set --env-file .env.supabase.generated
```

If you do not use the Supabase CLI, paste the generated values into Supabase project secrets.

## Targets

- `local`: local development and Codex runs.
- `frontend`: Vite build-time variables. Anything prefixed `VITE_` is public to the browser.
- `railway-web`: MCP server runtime on Railway.
- `railway-worker`: always-on scheduled registration worker on Railway.
- `supabase-functions`: Supabase Edge Function secrets.
- `smoke`: local smoke scripts.
- `github-actions`: GitHub Actions secrets or variables.

## Safety Rules

- Never put `SUPABASE_SERVICE_ROLE_KEY`, Stripe secrets, provider secrets, or PII encryption keys in `VITE_` variables.
- `env:check` masks secret values and prints only presence by default.
- `env:write` writes actual values to an ignored `.env.*` file; inspect it locally, do not commit it.
- Optional vars are omitted from target files unless you pass `--include-optional`.
- Recommended vars warn in `env:check`; required vars fail only when `--strict` is used.

## Updating The Env Surface

When adding, removing, or renaming an env var:

1. Update `scripts/envRegistry.ts`.
2. Regenerate `.env.example`:

```bash
npm run env:example --silent > .env.example
```

3. Run:

```bash
npm run env:check
npm run test -- tests/env-registry.test.ts
```

4. Update target runbooks only if operational behavior changed.
