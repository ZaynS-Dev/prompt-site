-- ============================================================
--  VR Shoot Prompts — Supabase Setup Script
--  Run this ONCE in the Supabase SQL Editor.
--  After running, refresh your app — everything is automatic.
-- ============================================================

-- ── 1. PROMPTS TABLE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prompts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT        NOT NULL,
  title            TEXT        NOT NULL,
  prompt           TEXT        NOT NULL DEFAULT '',
  negative_prompt  TEXT,
  pose_category    TEXT,
  dress_category   TEXT,
  tags             TEXT[]      DEFAULT '{}',
  notes            TEXT,
  is_favorite      BOOLEAN     DEFAULT false,
  usage_count      INTEGER     DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  last_used_at     TIMESTAMPTZ,
  is_deleted       BOOLEAN     DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_prompts_user_id        ON prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_prompts_pose_category  ON prompts(pose_category);
CREATE INDEX IF NOT EXISTS idx_prompts_dress_category ON prompts(dress_category);
CREATE INDEX IF NOT EXISTS idx_prompts_created_at     ON prompts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompts_is_favorite    ON prompts(is_favorite);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_prompts_updated_at ON prompts;
CREATE TRIGGER set_prompts_updated_at
  BEFORE UPDATE ON prompts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. PROMPT IMAGES TABLE ────────────────────────────────────
CREATE TABLE IF NOT EXISTS prompt_images (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id    UUID        REFERENCES prompts(id) ON DELETE CASCADE,
  image_url    TEXT        NOT NULL,
  storage_path TEXT        NOT NULL,
  image_order  INTEGER     DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_images_prompt_id ON prompt_images(prompt_id);

-- ── 3. HISTORY LOG TABLE ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS history_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT        NOT NULL,
  action       TEXT        NOT NULL,
  -- action values: created | updated | deleted | used | favorited | unfavorited | restored
  prompt_id    UUID,
  prompt_title TEXT,
  details      JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_user_id    ON history_log(user_id);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON history_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_action     ON history_log(action);
CREATE INDEX IF NOT EXISTS idx_history_prompt_id  ON history_log(prompt_id);

-- ── 4. BACKUPS TABLE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backups (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT        NOT NULL,
  backup_data    JSONB       NOT NULL,
  prompts_count  INTEGER,
  backup_size_kb INTEGER,
  backup_type    TEXT        DEFAULT 'auto',  -- 'auto' | 'manual'
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backups_user_id    ON backups(user_id);
CREATE INDEX IF NOT EXISTS idx_backups_created_at ON backups(created_at DESC);

-- ── 5. ROW LEVEL SECURITY ─────────────────────────────────────
ALTER TABLE prompts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE history_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE backups       ENABLE ROW LEVEL SECURITY;

-- Allow full anon access (single-user personal app — client filters by user_id)
CREATE POLICY "Allow anon access on prompts"
  ON prompts FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon access on prompt_images"
  ON prompt_images FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon access on history_log"
  ON history_log FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon access on backups"
  ON backups FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- ── 6. STORAGE BUCKET ────────────────────────────────────────
-- Creates the 'prompt-images' bucket as public
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'prompt-images',
  'prompt-images',
  true,
  10485760,  -- 10 MB per file limit
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760;

-- Storage policies for anon access
CREATE POLICY "Allow anon upload to prompt-images"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'prompt-images');

CREATE POLICY "Allow anon read from prompt-images"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'prompt-images');

CREATE POLICY "Allow anon delete from prompt-images"
  ON storage.objects FOR DELETE TO anon
  USING (bucket_id = 'prompt-images');

CREATE POLICY "Allow anon update in prompt-images"
  ON storage.objects FOR UPDATE TO anon
  USING (bucket_id = 'prompt-images');

-- ── DONE ─────────────────────────────────────────────────────
-- All tables, indexes, RLS policies, and storage bucket are ready.
-- Refresh your VR Shoot Prompts app — it will auto-connect.
