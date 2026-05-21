/* =====================================================
   config.js — VR Shoot Prompts Configuration
   Pre-configured with Supabase credentials.
   No changes needed — just run supabase_setup.sql once.
   ===================================================== */

const AppConfig = {
  // ── Supabase ──────────────────────────────────────────
  SUPABASE_URL:      'https://ystqjymnsfpvvmgytpei.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzdHFqeW1uc2ZwdnZtZ3l0cGVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNTY2NDksImV4cCI6MjA5NDkzMjY0OX0.uMCC9pt5oVhmlVA1rkS3k_9UwfCSJVAVpiRgADYycus',
  STORAGE_BUCKET:    'prompt-images',

  // ── Cloud Sync ────────────────────────────────────────
  ENABLE_CLOUD_SYNC:            true,   // set false to run fully offline
  SYNC_INTERVAL_MINUTES:        5,      // how often background sync runs
  AUTO_BACKUP_INTERVAL_MINUTES: 30,     // how often auto-backups are created
  MAX_BACKUPS_TO_KEEP:          20,     // older backups auto-pruned

  // ── Image upload ──────────────────────────────────────
  IMAGE_MAX_SIZE_BYTES: 1_048_576,      // 1 MB max after compression
  IMAGE_MAX_DIM:        1280,           // max pixel dimension
  IMAGE_QUALITY:        0.82,

  // ── History ──────────────────────────────────────────
  HISTORY_PAGE_SIZE: 20,               // entries per "Load more"
};

// Freeze to avoid accidental mutation
Object.freeze(AppConfig);
