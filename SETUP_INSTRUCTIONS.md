# ☁️ Supabase Cloud Setup — Just 2 Steps

Your VR Shoot Prompts app is **already configured** with Supabase credentials.  
You only need to do this once.

---

## Step 1 — Run the SQL Script

1. Go to [supabase.com](https://supabase.com) → Your project → **SQL Editor**
2. Click **New Query**
3. Open the file `supabase_setup.sql` from this project folder
4. **Paste the entire contents** into the editor
5. Click **Run** (▶ button)

> You'll see "Success" at the bottom. That's it — all 4 tables and the storage bucket are created.

---

## Step 2 — Verify Storage Bucket (optional)

If the SQL didn't create the bucket automatically:

1. In Supabase, go to **Storage** in the left sidebar
2. Click **Create new bucket**
3. Name: `prompt-images`
4. Check **Public bucket** ✓
5. Click **Save**

---

## Step 3 — Refresh the App

Reload your VR Shoot Prompts page.

- The **sync indicator** in the top bar will turn 🟢 **green** (Synced)
- All existing local prompts will automatically upload to the cloud
- From now on, every action (create, edit, delete, copy) is auto-synced

---

## ✅ What Just Got Set Up

| Feature | Description |
|---------|-------------|
| **Auto Sync** | Every 5 minutes, changes sync to Supabase |
| **Offline Queue** | If offline, changes queue up and sync when back online |
| **History Log** | Every create/edit/delete/copy action is logged |
| **Auto Backups** | Full backup every 30 minutes, keeps last 20 |
| **Image Storage** | Images uploaded to `prompt-images` Supabase bucket |
| **Restore** | Click "Restore" in History to un-delete any prompt |
| **Settings Page** | Test connection, manual sync, backup management |

---

## 🧠 How It Works

```
You edit a prompt
    ↓
Saved to LocalStorage (instant, works offline)
    ↓
Queued for cloud sync
    ↓
Pushed to Supabase prompts table (background, non-blocking)
    ↓
History action logged in history_log table
    ↓
Every 30 min: full backup saved to backups table
```

---

## 🔑 Credentials Info

- **SUPABASE_URL** and **SUPABASE_ANON_KEY** are pre-filled in `js/config.js`
- The **anon key** is safe to use in client-side code — it has row-level security policies
- No service role key or secret key is used anywhere in the frontend

---

## ❓ Troubleshooting

| Problem | Solution |
|---------|----------|
| Sync indicator shows 🔴 Offline | Check internet connection |
| Sync indicator shows ⚠️ Sync Error | Go to Settings → Test Connection |
| "Table not found" error | Re-run `supabase_setup.sql` in SQL Editor |
| Images not uploading to cloud | Verify `prompt-images` bucket exists and is public |
| History view shows "Cloud not connected" | Run `supabase_setup.sql` and refresh |

---

## 🗄️ Database Tables Created

- `prompts` — all prompt metadata
- `prompt_images` — image URLs from Supabase Storage
- `history_log` — audit trail of every action
- `backups` — automatic full-data snapshots

Storage bucket: `prompt-images` (public, allows anon read/write)
