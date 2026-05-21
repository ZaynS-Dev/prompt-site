/* =====================================================
   sync-manager.js — Local-first cloud sync engine
   Strategy:
     1. All writes go to LocalStorage first (instant)
     2. Push changes to Supabase in background
     3. If offline, queue changes → drain when back online
     4. On app load, pull cloud and merge (last-updated wins)
   ===================================================== */

const SyncManager = (() => {
  const LS_QUEUE    = 'vrshoot.syncQueue';
  const LS_LAST_PULL = 'vrshoot.lastPullAt';
  const LS_MIGRATED  = 'vrshoot.cloudMigrated';

  let _status = 'offline';   // 'synced' | 'syncing' | 'offline' | 'error'
  let _lastSync = null;
  let _pendingCount = 0;
  let _syncInterval = null;
  let _onStatusChange = null;

  /* ── Status management ───────────────────────────── */
  function setStatus(s) {
    _status = s;
    updateSyncUI();
    if (_onStatusChange) _onStatusChange(s);
  }
  function getStatus() { return _status; }
  function getLastSync() { return _lastSync; }
  function getPendingCount() { return _pendingCount; }
  function onStatusChange(fn) { _onStatusChange = fn; }

  /* ── Offline queue helpers ───────────────────────── */
  function getQueue() {
    try { return JSON.parse(localStorage.getItem(LS_QUEUE) || '[]'); }
    catch { return []; }
  }
  function saveQueue(q) {
    try { localStorage.setItem(LS_QUEUE, JSON.stringify(q)); } catch {}
  }
  function enqueue(op) {
    const q = getQueue();
    // Deduplicate: if same id + action, replace
    const idx = q.findIndex(x => x.id === op.id && x.action === op.action);
    if (idx >= 0) q[idx] = op; else q.push(op);
    saveQueue(q);
    _pendingCount = q.length;
    updateSyncUI();
  }
  function dequeue(opId) {
    const q = getQueue().filter(x => x._qid !== opId);
    saveQueue(q);
    _pendingCount = q.length;
  }

  /* ── Main init ───────────────────────────────────── */
  async function init() {
    if (!AppConfig.ENABLE_CLOUD_SYNC) { setStatus('offline'); return; }

    // Network listeners
    window.addEventListener('online',  () => { console.info('[Sync] Back online — draining queue'); drainQueue(); startInterval(); });
    window.addEventListener('offline', () => { setStatus('offline'); stopInterval(); });

    if (!navigator.onLine) { setStatus('offline'); return; }
    if (!SupabaseClient.isReady()) { setStatus('error'); return; }

    setStatus('syncing');

    // First-ever migration: push all local data to cloud
    if (!localStorage.getItem(LS_MIGRATED)) {
      await migrateLocalToCloud();
    } else {
      await pullFromCloud();
    }

    await drainQueue();
    startInterval();
  }

  /* ── Migration: local → cloud (first run) ─────── */
  async function migrateLocalToCloud() {
    const prompts = Storage.getPrompts();
    if (!prompts.length) {
      localStorage.setItem(LS_MIGRATED, 'true');
      setStatus('synced'); _lastSync = new Date();
      return;
    }
    console.info(`[Sync] Migrating ${prompts.length} local prompt(s) to cloud…`);
    UI.toast(`Uploading ${prompts.length} local prompts to cloud…`, 'info', 3000);
    let pushed = 0;
    for (const p of prompts) {
      await upsertPrompt(p);
      pushed++;
    }
    localStorage.setItem(LS_MIGRATED, 'true');
    _lastSync = new Date();
    setStatus('synced');
    console.info(`[Sync] Migration complete — ${pushed} prompts pushed`);
    UI.toast('All local prompts synced to cloud ✓', 'success');
  }

  /* ── Pull from cloud, merge with local ──────────── */
  async function pullFromCloud() {
    if (!SupabaseClient.isReady() || !navigator.onLine) return;
    setStatus('syncing');
    const uid = SupabaseClient.getUserId();
    try {
      // Fetch all non-deleted cloud prompts
      const { data: cloudPrompts, error } = await SupabaseClient.get()
        .from('prompts')
        .select('*')
        .eq('user_id', uid)
        .eq('is_deleted', false);

      if (error) throw error;

      const localMap  = {};
      Storage.getPrompts().forEach(p => { localMap[p.id] = p; });
      const cloudMap  = {};
      (cloudPrompts || []).forEach(p => { cloudMap[p.id] = cloudToLocal(p); });

      // Merge: last updated_at wins
      const merged = [];
      const allIds = new Set([...Object.keys(localMap), ...Object.keys(cloudMap)]);

      for (const id of allIds) {
        const local = localMap[id];
        const cloud = cloudMap[id];
        if (local && cloud) {
          merged.push(new Date(cloud.updatedAt) >= new Date(local.updatedAt) ? cloud : local);
        } else if (cloud) {
          merged.push(cloud);  // exists only in cloud → add locally
        } else {
          merged.push(local);  // exists only locally → keep (will be pushed via queue)
        }
      }

      Storage.setPrompts(merged);
      localStorage.setItem(LS_LAST_PULL, new Date().toISOString());
      _lastSync = new Date();
      setStatus('synced');
      updateSyncUI();
    } catch (err) {
      console.warn('[Sync] Pull failed:', err);
      setStatus('error');
    }
  }

  /* ── Push a single prompt to cloud ──────────────── */
  async function upsertPrompt(localPrompt) {
    if (!SupabaseClient.isReady()) return false;
    try {
      const row = localToCloud(localPrompt);
      const { error } = await SupabaseClient.get()
        .from('prompts')
        .upsert(row, { onConflict: 'id' });
      if (error) { console.warn('[Sync] upsert error:', error.message); return false; }
      return true;
    } catch (err) {
      console.warn('[Sync] upsert exception:', err);
      return false;
    }
  }

  /* ── Soft-delete a prompt in cloud ──────────────── */
  async function softDeletePrompt(id) {
    if (!SupabaseClient.isReady()) return false;
    try {
      const { error } = await SupabaseClient.get()
        .from('prompts')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('id', id);
      return !error;
    } catch { return false; }
  }

  /* ── Offline queue operations ────────────────────── */
  function queueUpsert(prompt) {
    enqueue({ _qid: 'up-' + prompt.id, action: 'upsert', id: prompt.id, data: prompt, ts: Date.now() });
  }
  function queueDelete(id) {
    // Remove any pending upsert for same id
    const q = getQueue().filter(x => !(x.action === 'upsert' && x.id === id));
    saveQueue(q);
    enqueue({ _qid: 'del-' + id, action: 'delete', id, ts: Date.now() });
  }

  async function drainQueue() {
    if (!SupabaseClient.isReady() || !navigator.onLine) return;
    const q = getQueue();
    if (!q.length) { setStatus('synced'); _lastSync = new Date(); updateSyncUI(); return; }

    setStatus('syncing');
    const failed = [];
    for (const op of q) {
      let ok = false;
      if (op.action === 'upsert') {
        const latest = Storage.getPrompt(op.id) || op.data;
        ok = await upsertPrompt(latest);
      } else if (op.action === 'delete') {
        ok = await softDeletePrompt(op.id);
      }
      if (!ok) failed.push(op);
    }
    saveQueue(failed);
    _pendingCount = failed.length;
    _lastSync = new Date();
    setStatus(failed.length ? 'error' : 'synced');
    updateSyncUI();
    if (failed.length) console.warn(`[Sync] ${failed.length} op(s) failed — will retry`);
  }

  /* ── Interval sync ───────────────────────────────── */
  function startInterval() {
    stopInterval();
    const ms = AppConfig.SYNC_INTERVAL_MINUTES * 60_000;
    _syncInterval = setInterval(async () => {
      if (!navigator.onLine) return;
      await drainQueue();
      await pullFromCloud();
    }, ms);
  }
  function stopInterval() {
    if (_syncInterval) { clearInterval(_syncInterval); _syncInterval = null; }
  }

  /* ── Manual sync now ──────────────────────────────── */
  async function syncNow() {
    if (!navigator.onLine) { UI.toast('You are offline', 'error'); return; }
    if (!SupabaseClient.isReady()) { UI.toast('Not connected to cloud', 'error'); return; }
    setStatus('syncing');
    UI.toast('Syncing…', 'info', 1500);
    await drainQueue();
    await pullFromCloud();
    UI.toast('Sync complete ✓', 'success');
  }

  /* ── Data shape converters ───────────────────────── */
  function localToCloud(p) {
    return {
      id:              p.id,
      user_id:         SupabaseClient.getUserId(),
      title:           p.title || '',
      prompt:          p.prompt || '',
      negative_prompt: p.negativePrompt || null,
      pose_category:   p.poseCategory  || null,
      dress_category:  p.dressCategory || null,
      tags:            p.tags || [],
      notes:           p.notes || null,
      is_favorite:     !!p.isFavorite,
      usage_count:     p.usageCount || 0,
      created_at:      p.createdAt  || new Date().toISOString(),
      updated_at:      p.updatedAt  || new Date().toISOString(),
      last_used_at:    p.lastUsedAt || null,
      is_deleted:      false
    };
  }

  function cloudToLocal(c) {
    return {
      id:             c.id,
      title:          c.title,
      prompt:         c.prompt,
      negativePrompt: c.negative_prompt || '',
      images:         [],   // images stay in IndexedDB, cloud URLs separate
      poseCategory:   c.pose_category  || '',
      dressCategory:  c.dress_category || '',
      tags:           c.tags || [],
      notes:          c.notes || '',
      isFavorite:     !!c.is_favorite,
      usageCount:     c.usage_count || 0,
      createdAt:      c.created_at,
      updatedAt:      c.updated_at,
      lastUsedAt:     c.last_used_at || null
    };
  }

  /* ── Sync indicator DOM helper ───────────────────── */
  function updateSyncUI() {
    const dot = document.getElementById('syncDot');
    const label = document.getElementById('syncLabel');
    const pending = document.getElementById('syncPending');
    if (!dot) return;

    dot.className = 'sync-dot';
    const map = {
      synced:  { cls: 'synced',  text: 'Synced' },
      syncing: { cls: 'syncing', text: 'Syncing…' },
      offline: { cls: 'offline', text: 'Offline' },
      error:   { cls: 'error',   text: 'Sync Error' }
    };
    const m = map[_status] || map.offline;
    dot.classList.add(m.cls);
    if (label) label.textContent = m.text;
    if (pending) {
      pending.textContent = _pendingCount ? `${_pendingCount} pending` : '';
      pending.style.display = _pendingCount ? '' : 'none';
    }
    // Update popup last sync time
    const ls = document.getElementById('popupLastSync');
    if (ls) ls.textContent = _lastSync ? 'Last sync: ' + UI.formatDate(_lastSync.toISOString()) : 'Not synced yet';
    const pp = document.getElementById('popupPending');
    if (pp) pp.textContent = _pendingCount ? `${_pendingCount} change(s) pending` : 'All changes synced';
  }

  /* ── Delete all cloud data ───────────────────────── */
  async function deleteAllCloudData() {
    if (!SupabaseClient.isReady()) return false;
    const uid = SupabaseClient.getUserId();
    try {
      await SupabaseClient.get().from('prompts').delete().eq('user_id', uid);
      await SupabaseClient.get().from('history_log').delete().eq('user_id', uid);
      await SupabaseClient.get().from('backups').delete().eq('user_id', uid);
      localStorage.removeItem(LS_MIGRATED);
      localStorage.removeItem(LS_QUEUE);
      return true;
    } catch (err) {
      console.error('[Sync] deleteAll failed:', err);
      return false;
    }
  }

  return {
    init, syncNow, pullFromCloud,
    queueUpsert, queueDelete,
    drainQueue, getStatus, getLastSync,
    getPendingCount, onStatusChange, updateSyncUI,
    deleteAllCloudData
  };
})();
