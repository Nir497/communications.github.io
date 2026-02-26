# Supabase Setup (GitHub Pages-Compatible Frontend + External Backend)

GitHub Pages hosts only the frontend. Supabase hosts auth/database/storage.

## 1. Create Supabase Project
- Create a new project in Supabase.
- Open `Project Settings` -> `API`.
- Copy:
  - `Project URL`
  - `anon public` key

## 2. Configure the App Locally
- Copy `.env.example` to `.env`
- Set:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

## 3. Create Database Schema
- In Supabase Dashboard -> `SQL Editor`
- Run `supabase/schema.sql`

## 4. Auth Provider
- In Supabase Dashboard -> `Authentication` -> `Providers`
- Enable `Email`
- If you want immediate sign-ins without email verification while testing:
  - Disable email confirmations (or configure SMTP)

## 5. Current Integration Status
- Implemented:
  - Supabase email/password sign up / sign in
  - Shared profile directory sync into local app cache
  - DM picker can see Supabase profiles (mirrored locally)
- Not yet migrated:
  - Chats/messages/groups/files persistence and sync (still local IndexedDB)

## 6. Deploying on GitHub Pages
- Add the same variables in GitHub:
  - Repo `Settings` -> `Secrets and variables` -> `Actions` -> `Variables`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Ensure the GitHub Actions workflow passes them into the build environment.

Example workflow build step snippet:

```yaml
      - name: Build
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ vars.VITE_SUPABASE_ANON_KEY }}
```

## 7. Next Migration Step (Recommended)
- Replace local `ChatRepository` chat/message methods with Supabase-backed methods:
  - `getVisibleChatsForProfile`
  - `createDm`
  - `createGroup`
  - `getMessages`
  - `sendMessage`
  - group membership actions
- Move attachments to Supabase Storage bucket (`chat-files`)
