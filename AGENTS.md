# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains all frontend code.
- `src/App.tsx` is the main UI shell (auth gate, sidebar, chat views, dialogs).
- `src/storage/` contains local IndexedDB/localStorage logic (`repository.ts`) and sync bus.
- `src/backend/` contains Supabase integration (`supabaseClient.ts`, `supabaseAuth.ts`).
- `src/types.ts` defines shared application/domain types.
- `src/styles.css` holds global styling.
- `supabase/schema.sql` contains database schema + RLS policies.
- `SUPABASE_SETUP.md` documents backend setup and deployment env variables.

## Build, Test, and Development Commands
- `npm install` — install dependencies.
- `npm run dev` — start local Vite dev server.
- `npm run build` — type-check and build production assets into `dist/`.
- `npm run preview` — preview the production build locally.

Example:
```bash
npm install
npm run dev
```

## Coding Style & Naming Conventions
- Language: TypeScript + React (functional components, hooks).
- Indentation: 2 spaces; keep code readable and avoid deep nesting.
- Naming:
  - Components: `PascalCase` (`AuthGate`, `ChatView`)
  - Functions/variables: `camelCase`
  - Constants: `UPPER_SNAKE_CASE` for module-level constants
  - Files: feature-based, descriptive (`supabaseAuth.ts`, `repository.ts`)
- Prefer explicit types for domain objects and async method return values.

## Testing Guidelines
- No formal test suite is configured yet.
- Minimum validation before PR: run `npm run build` successfully.
- When adding tests, use Vitest + React Testing Library and colocate as `*.test.ts(x)` near source files.
- Prioritize auth flows, chat creation, group membership actions, and attachment handling.

## Commit & Pull Request Guidelines
- Follow concise imperative commit messages seen in history, e.g.:
  - `Add local password auth gate`
  - `Hide signup after local account exists`
- PRs should include:
  - summary of user-visible changes,
  - setup/config changes (`.env`, Supabase schema, Actions vars),
  - screenshots/GIFs for UI updates,
  - verification steps (`npm run build`, auth/chat flow checks).

## Security & Configuration Tips
- Never commit `.env` or secrets.
- Use only Supabase `anon` key in frontend; keep service-role keys out of client code.
- For GitHub Pages builds, configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in GitHub Actions variables.
