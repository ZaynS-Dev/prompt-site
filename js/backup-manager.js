/* =====================================================
   backup-manager.js — Auto & manual backup to Supabase
   Keeps last N backups, prunes older ones.
   ===================================================== */

const BackupManager = (() => {
  const LS_LAST_BACKUP = 'vrshoot.lastBackupAt';
  const LS_AUTO_BACKUP = 'vrshoot.autoBackupEnabled';
  let _timer = null;

  /* ── Public: start timer ─────────────────────────── */
  function startAutoBackup() {
    stopAutoBackup();
    if (!isAutoEnabled()) return;
    const ms = AppConfig.AUTO_BACKUP_INTERVAL_MINUTES * 60_000;
    _timer = setInterval(async () => {
      if (SupabaseClient.isReady() && navigator.onLine) {
        await createBackup('auto', false);
      }
    }, ms);
    console.info(`[Backup] Auto-backup every ${AppConfig.AUTO_BACKUP_INTERVAL_MINUTES}min`);
  }

  function stopAutoBackup() {
    if (_timer) { clearInterval(_timer); _timer = null; }
  }

  function isAutoEnabled() {
    const v = localStorage.getItem(LS_AUTO_BACKUP);
    return v === null ? true : v === 'true';
  }

  function setAutoEnabled(bool) {
    localStorage.setItem(LS_AUTO_BACKUP, String(bool));
    if (bool) startAutoBackup(); else stopAutoBackup();
  }

  function getLastBackupAt() {
    return localStorage.getItem(LS_LAST_BACKUP) || null;
  }

  /* ── Create a backup ─────────────────────────────── */
  async function createBackup(type = 'manual', showToast = true) {
    if (!SupabaseClient.isReady()) {
      if (showToast) UI.toast('Not connected to cloud', 'error');
      return null;
    }
    try {
      if (showToast) UI.toast('Creating backup…', 'info', 1500);

      // Build backup payload (no raw image blobs — use cloud image URLs instead)
      const data = await Storage.exportData(true);  // true = skip images (metadata only)
      const json = JSON.stringify(data);
      const kb   = Math.ceil(json.length / 1024);
      const uid  = SupabaseClient.getUserId();

      const { data: row, error } = await SupabaseClient.get()
        .from('backups')
        .insert({
          user_id:       uid,
          backup_data:   data,
          prompts_count: data.prompts.length,
          backup_size_kb: kb,
          backup_type:   type
        })
        .select()
        .single();

      if (error) throw error;

      // Update last backup timestamp
      localStorage.setItem(LS_LAST_BACKUP, new Date().toISOString());

      // Prune old backups
      await pruneOldBackups();

      if (showToast) UI.toast('Backup created ✓', 'success');
      return row;
    } catch (err) {
      console.error('[Backup] Create failed:', err);
      if (showToast) UI.toast('Backup failed: ' + err.message, 'error');
      return null;
    }
  }

  /* ── Prune old backups ───────────────────────────── */
  async function pruneOldBackups() {
    const uid = SupabaseClient.getUserId();
    try {
      // Get all backup IDs sorted newest first
      const { data } = await SupabaseClient.get()
        .from('backups')
        .select('id')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });

      if (!data || data.length <= AppConfig.MAX_BACKUPS_TO_KEEP) return;

      const toDelete = data.slice(AppConfig.MAX_BACKUPS_TO_KEEP).map(r => r.id);
      await SupabaseClient.get().from('backups').delete().in('id', toDelete);
      console.info(`[Backup] Pruned ${toDelete.length} old backup(s)`);
    } catch (err) {
      console.warn('[Backup] Prune failed:', err);
    }
  }

  /* ── List backups ────────────────────────────────── */
  async function listBackups() {
    if (!SupabaseClient.isReady()) return [];
    const uid = SupabaseClient.getUserId();
    try {
      const { data, error } = await SupabaseClient.get()
        .from('backups')
        .select('id, prompts_count, backup_size_kb, backup_type, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (error) return [];
      return data || [];
    } catch { return []; }
  }

  /* ── Restore a backup ────────────────────────────── */
  async function restoreBackup(backupId) {
    if (!SupabaseClient.isReady()) {
      UI.toast('Not connected to cloud', 'error');
      return false;
    }
    try {
      const { data, error } = await SupabaseClient.get()
        .from('backups')
        .select('backup_data')
        .eq('id', backupId)
        .single();

      if (error || !data) throw error || new Error('Backup not found');

      await Storage.importData(data.backup_data);
      UI.toast('Backup restored successfully!', 'success');
      return true;
    } catch (err) {
      console.error('[Backup] Restore failed:', err);
      UI.toast('Restore failed: ' + err.message, 'error');
      return false;
    }
  }

  /* ── Download a backup as JSON ───────────────────── */
  async function downloadBackup(backupId) {
    if (!SupabaseClient.isReady()) return;
    try {
      const { data } = await SupabaseClient.get()
        .from('backups')
        .select('backup_data, created_at')
        .eq('id', backupId)
        .single();
      if (!data) return;
      const blob = new Blob([JSON.stringify(data.backup_data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vrshoot-backup-${data.created_at.slice(0,10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      UI.toast('Download failed', 'error');
    }
  }

  /* ── Cloud stats ─────────────────────────────────── */
  async function getStats() {
    if (!SupabaseClient.isReady()) return { count: 0, totalKb: 0 };
    const uid = SupabaseClient.getUserId();
    try {
      const { data } = await SupabaseClient.get()
        .from('backups')
        .select('backup_size_kb')
        .eq('user_id', uid);
      const count   = data ? data.length : 0;
      const totalKb = data ? data.reduce((s, r) => s + (r.backup_size_kb || 0), 0) : 0;
      return { count, totalKb };
    } catch { return { count: 0, totalKb: 0 }; }
  }

  return {
    startAutoBackup, stopAutoBackup,
    isAutoEnabled, setAutoEnabled,
    getLastBackupAt,
    createBackup, restoreBackup, downloadBackup,
    listBackups, getStats
  };
})();
