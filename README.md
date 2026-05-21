# 🧡 VR Shoot Prompts — AI Fashion Photography Prompt Library

A personal, **offline-first + cloud-synced** web application to organize, categorize, and instantly retrieve AI prompts for fashion photography workflows. All data syncs automatically to Supabase in the background.

---

## ⚡ Quick Start (Cloud Setup)

1. Go to your **Supabase SQL Editor** → paste and run `supabase_setup.sql`
2. Verify `prompt-images` storage bucket is public (auto-created by SQL)
3. Refresh the app — green sync indicator = you're live ✓

See **`SETUP_INSTRUCTIONS.md`** for full details.

---

## ✨ Features

### Core
- Full CRUD with multiple reference images per prompt
- Drag & drop image upload → auto-compressed + uploaded to Supabase Storage
- Pose & Dress categories with custom additions
- Free-form tag system with autocomplete
- Favorites, usage tracking, notes, negative prompts

### Cloud (Supabase)
- **Auto sync** every 5 minutes — local-first, cloud in background
- **Offline queue** — changes queued when offline, drained when reconnected
- **Migration** — on first connect, all local data auto-uploads to cloud
- **Last-write-wins** conflict resolution using `updated_at`
- **Sync status indicator** in topbar (Synced 🟢 / Syncing 🟡 / Offline 🔴 / Error ⚠️)

### History
- **Activity timeline** — every create/edit/delete/copy logged
- **Restore deleted prompts** directly from History view
- Filter by action type, search by prompt title
- Paginated with "Load more"
- Export as CSV

### Backups
- **Auto-backup every 30 minutes** to Supabase `backups` table
- Keep last 20 backups, auto-prune older ones
- One-click **Restore** from any backup
- **Manual backup** button
- Download backup as JSON file

### Settings Page
- Cloud sync status (connected/disconnected badge)
- Sync frequency selector
- Backup management + restore list
- History stats + clear old history
- **Danger Zone**: clear local, delete cloud, reset all

### UX
- **Dark mode** toggle
- **Grid / List view** toggle
- Global search (Ctrl+F) — title, prompt, notes, tags, categories
- Sort: Newest / Oldest / Most Used / Recently Used
- Sidebar filters with live count badges
- Tag cloud
- Lightbox with ← → keyboard navigation
- Keyboard shortcuts: Ctrl+N (new), Ctrl+F (search), Esc (close)
- Toast notifications for all actions
- Responsive: mobile / tablet / desktop

---

## 📁 File Structure

```
index.html                 Main SPA shell
css/
  styles.css               All styles — theme, responsive, sync UI, history, settings
js/
  config.js                Supabase credentials + config (pre-filled)
  storage.js               LocalStorage + IndexedDB layer
  components.js            Toast, confirm modal, input modal helpers
  supabase-client.js       Supabase client singleton + userId management
  image-uploader.js        Upload blobs to Supabase Storage
  history-manager.js       Log/fetch/clear action history
  backup-manager.js        Auto/manual backup + restore + prune
  sync-manager.js          Offline queue, pull/push, conflict resolution
  app.js                   Main app — all views, CRUD, events
supabase_setup.sql         Run once in Supabase SQL Editor
SETUP_INSTRUCTIONS.md      Step-by-step cloud setup guide
README.md                  This file
```

---

## 🌐 Views / Navigation

| View | Access | Content |
|------|--------|---------|
| Dashboard | Sidebar → Dashboard | Stats, recent, favorites |
| All Prompts | Sidebar → All Prompts | Full grid with search/filter/sort |
| Favorites | Sidebar → Favorites | Starred prompts only |
| By Pose | Sidebar → By Pose Type | Filtered by pose category |
| By Dress | Sidebar → By Dress Type | Filtered by dress category |
| By Tag | Sidebar → Tag cloud | Filtered by tag |
| History | Sidebar → History | Action timeline with restore |
| Settings | Sidebar → Settings | Cloud, backup, danger zone |

---

## 📦 Data Model

```js
// LocalStorage prompt
{
  id, title, prompt, negativePrompt,
  images: ['localIndexedDBid1', ...],  // IndexedDB image blob IDs
  poseCategory, dressCategory,
  tags: ['studio-light', 'white-bg'],
  notes, isFavorite, usageCount,
  createdAt, updatedAt, lastUsedAt
}
```

```sql
-- Supabase tables
prompts         -- prompt metadata (mirrors local, with user_id + is_deleted)
prompt_images   -- cloud Storage URLs per prompt
history_log     -- audit trail (action, prompt_id, prompt_title, details, created_at)
backups         -- full JSON snapshots (backup_data JSONB)
```

### Storage Layers

| Layer | Data | Keys |
|-------|------|------|
| LocalStorage | Prompts, categories, tags, settings | `vrshoot.*` |
| IndexedDB | Image blobs (compressed WebP) | DB: `vrshoot-db` |
| Supabase DB | Mirror of prompts + history + backups | `prompts`, `history_log`, `backups` |
| Supabase Storage | Image files | bucket: `prompt-images` |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + N` | New prompt |
| `Ctrl/Cmd + F` | Focus search |
| `Esc` | Close modal / lightbox |
| `← / →` | Navigate lightbox images |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Markup | Semantic HTML5 |
| Styling | CSS3 + CSS Variables |
| Logic | Vanilla JS (ES6+) |
| Icons | Lucide Icons (CDN) |
| Fonts | Inter + Poppins (Google) |
| Cloud DB | Supabase (PostgreSQL) |
| Cloud Storage | Supabase Storage |
| Local persistence | LocalStorage + IndexedDB |
| Cloud Client | @supabase/supabase-js v2 (CDN) |

**No build step. No framework. No backend server.**

---

## 🔒 Security

- Only the **anon key** is used client-side — safe to expose
- Row Level Security (RLS) enabled on all tables
- `user_id` is a random UUID stored in localStorage (no login needed)
- No analytics, no telemetry — all data stays on your device + your Supabase instance

---

## 📋 Not Yet Implemented

- ❌ Multi-select bulk actions (delete/tag multiple prompts)
- ❌ PWA / Service Worker (for fully installable offline app)
- ❌ Prompt versioning / edit history diff
- ❌ AI-assisted tag suggestions
- ❌ Drag-to-reorder prompts
- ❌ Date range filter in History
