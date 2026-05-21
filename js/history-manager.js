/* =====================================================
   history-manager.js — Action logging + retrieval
   Logs to Supabase history_log table.
   Falls back silently if offline.
   ===================================================== */

const HistoryManager = (() => {
  const ACTIONS = {
    CREATED:    'created',
    UPDATED:    'updated',
    DELETED:    'deleted',
    USED:       'used',
    FAVORITED:  'favorited',
    UNFAVORITED:'unfavorited',
    RESTORED:   'restored'
  };

  const ACTION_META = {
    created:    { icon: 'plus-circle',    label: 'Created',       color: 'var(--success)' },
    updated:    { icon: 'pencil',         label: 'Updated',       color: 'var(--info)' },
    deleted:    { icon: 'trash-2',        label: 'Deleted',       color: 'var(--danger)' },
    used:       { icon: 'copy',           label: 'Copied',        color: 'var(--primary)' },
    favorited:  { icon: 'star',           label: 'Favorited',     color: 'var(--warning)' },
    unfavorited:{ icon: 'star-off',       label: 'Unfavorited',   color: 'var(--text-2)' },
    restored:   { icon: 'rotate-ccw',     label: 'Restored',      color: 'var(--success)' }
  };

  /**
   * Log an action to Supabase history_log.
   * Never throws — silently fails if offline.
   */
  async function log(action, prompt, details = {}) {
    if (!SupabaseClient.isReady() || !AppConfig.ENABLE_CLOUD_SYNC) return;
    const uid = SupabaseClient.getUserId();
    try {
      await SupabaseClient.get().from('history_log').insert({
        user_id:      uid,
        action,
        prompt_id:    prompt?.id || null,
        prompt_title: prompt?.title || null,
        details:      Object.keys(details).length ? details : null
      });
    } catch (err) {
      console.warn('[History] log failed:', err);
    }
  }

  /**
   * Fetch paginated history entries.
   * Returns { entries, hasMore }
   */
  async function fetch({ page = 1, limit = null, action = '', search = '' } = {}) {
    const pageSize = limit || AppConfig.HISTORY_PAGE_SIZE;
    const from = (page - 1) * pageSize;
    const to   = from + pageSize - 1;

    if (!SupabaseClient.isReady()) return { entries: [], hasMore: false };
    const uid = SupabaseClient.getUserId();
    try {
      let q = SupabaseClient.get()
        .from('history_log')
        .select('*', { count: 'exact' })
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (action) q = q.eq('action', action);
      if (search) q = q.ilike('prompt_title', `%${search}%`);

      const { data, count, error } = await q;
      if (error) { console.warn('[History] fetch error:', error.message); return { entries: [], hasMore: false }; }
      return { entries: data || [], hasMore: (from + pageSize) < count };
    } catch (err) {
      console.warn('[History] fetch exception:', err);
      return { entries: [], hasMore: false };
    }
  }

  /**
   * Get total count of logged actions.
   */
  async function getTotalCount() {
    if (!SupabaseClient.isReady()) return 0;
    const uid = SupabaseClient.getUserId();
    try {
      const { count } = await SupabaseClient.get()
        .from('history_log')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', uid);
      return count || 0;
    } catch { return 0; }
  }

  /**
   * Delete history older than N days.
   */
  async function clearOlderThan(days) {
    if (!SupabaseClient.isReady()) return false;
    const uid = SupabaseClient.getUserId();
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    try {
      const { error } = await SupabaseClient.get()
        .from('history_log')
        .delete()
        .eq('user_id', uid)
        .lt('created_at', cutoff);
      return !error;
    } catch { return false; }
  }

  /**
   * Fetch all history for CSV export.
   */
  async function fetchAll() {
    if (!SupabaseClient.isReady()) return [];
    const uid = SupabaseClient.getUserId();
    try {
      const { data } = await SupabaseClient.get()
        .from('history_log')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });
      return data || [];
    } catch { return []; }
  }

  return { log, fetch, fetchAll, getTotalCount, clearOlderThan, ACTIONS, ACTION_META };
})();
