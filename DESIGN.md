# Frontend-Only Local Texting Platform Design

## Summary
- Static web app (React + Vite + TypeScript) hosted on GitHub Pages.
- No backend/server required.
- Local profiles ("accounts"), DMs, group chats, file uploads/downloads, inline image previews.
- Persistent browser storage using IndexedDB + localStorage.
- Cross-tab live sync using BroadcastChannel (with storage event fallback).

## Core Requirements
- Sidebar navigation split between DMs and Group Chats
- Empty state in main panel: "No chat selected"
- Clean, modern, light-themed UI
- Users can:
  - create/select local profiles
  - create DMs and groups
  - add people to groups
  - leave groups
  - view group members
  - send text + file/image attachments
  - download sent files
- Chats persist after browser/tab close and reopen

## Architecture
- React SPA with hash routing (`#/chat/:id`)
- IndexedDB stores:
  - profiles
  - chats
  - memberships
  - messages
  - attachmentsMeta
  - attachmentsBlob
  - kv
- localStorage for lightweight UI/session prefs:
  - active profile id
  - selected chat id per profile
  - seeding flag
- BroadcastChannel for cross-tab sync events

## Data Model
- `Profile`: local user identity (`id`, `displayName`, etc.)
- `Chat`: `dm` or `group`
- `ChatMembership`: current/history membership via `leftAt`
- `Message`: text/system/file/image/mixed
- `Attachment`: metadata + blob storage key

## Product Decisions (Locked)
- React + Vite
- Local profiles only (no authentication)
- Invite-only local group membership (no public discover/join)
- IndexedDB attachment persistence
- Conservative file limits:
  - 10 MB per file
  - 100 MB total attachment soft cap
- Seed demo data on first run
- Live sync across tabs on same browser/device

## Implementation Phases
1. Scaffold app and base styles
2. Implement storage/repository + schema
3. Profile flow + seed demo data
4. Sidebar + chat routing + empty state
5. DMs/groups + messaging
6. Group membership management UI
7. Attachment upload/download + inline image thumbnails
8. Cross-tab sync
9. Tests / manual validation

## Hosting Notes (GitHub Pages)
- Hash routing avoids 404 rewrite issues
- Vite `base` should be configured for static relative assets (or repo path)
- Fully static output in `dist/`

## Assumptions
- Browser-local storage only (no cross-device sync)
- No message edit/delete, read receipts, typing indicators, or auth security in v1
