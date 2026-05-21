/* =====================================================
   components.js — Reusable UI helpers
   ===================================================== */

const UI = (() => {

  /* ---------- Toast notifications ---------- */
  function toast(message, type = 'info', duration = 2400) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const iconMap = {
      success: 'check-circle',
      error:   'x-circle',
      info:    'info'
    };
    el.innerHTML = `<i data-lucide="${iconMap[type] || 'info'}"></i><span>${escapeHtml(message)}</span>`;
    container.appendChild(el);
    if (window.lucide) lucide.createIcons();
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(40px)';
      el.style.transition = 'all 0.2s ease';
      setTimeout(() => el.remove(), 200);
    }, duration);
  }

  /* ---------- Confirm modal ---------- */
  function confirm({ title = 'Are you sure?', message = 'This action cannot be undone.', okText = 'Delete', danger = true } = {}) {
    return new Promise(resolve => {
      const modal = document.getElementById('confirmModal');
      document.getElementById('confirmTitle').textContent = title;
      document.getElementById('confirmMessage').textContent = message;
      const ok = document.getElementById('confirmOkBtn');
      ok.textContent = okText;
      ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
      modal.classList.remove('hidden');

      const close = (val) => {
        modal.classList.add('hidden');
        ok.removeEventListener('click', onOk);
        modal.querySelectorAll('[data-close="confirmModal"]').forEach(b => b.removeEventListener('click', onCancel));
        resolve(val);
      };
      const onOk = () => close(true);
      const onCancel = () => close(false);
      ok.addEventListener('click', onOk);
      modal.querySelectorAll('[data-close="confirmModal"]').forEach(b => b.addEventListener('click', onCancel));
    });
  }

  /* ---------- Input prompt modal (for new category) ---------- */
  function input({ title = 'Add', label = 'Name', placeholder = '', okText = 'Add' } = {}) {
    return new Promise(resolve => {
      const modal = document.getElementById('inputModal');
      document.getElementById('inputTitle').textContent = title;
      document.getElementById('inputLabel').textContent = label;
      const field = document.getElementById('inputField');
      field.value = '';
      field.placeholder = placeholder;
      const ok = document.getElementById('inputOkBtn');
      ok.textContent = okText;
      modal.classList.remove('hidden');
      setTimeout(() => field.focus(), 50);

      const close = (val) => {
        modal.classList.add('hidden');
        ok.removeEventListener('click', onOk);
        field.removeEventListener('keydown', onKey);
        modal.querySelectorAll('[data-close="inputModal"]').forEach(b => b.removeEventListener('click', onCancel));
        resolve(val);
      };
      const onOk = () => close(field.value.trim() || null);
      const onCancel = () => close(null);
      const onKey = (e) => { if (e.key === 'Enter') onOk(); };
      ok.addEventListener('click', onOk);
      field.addEventListener('keydown', onKey);
      modal.querySelectorAll('[data-close="inputModal"]').forEach(b => b.addEventListener('click', onCancel));
    });
  }

  /* ---------- Helpers ---------- */
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); document.body.removeChild(ta); return true; }
      catch { document.body.removeChild(ta); return false; }
    }
  }

  function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('hidden');
  }

  function refreshIcons() {
    if (window.lucide) lucide.createIcons();
  }

  return { toast, confirm, input, escapeHtml, formatDate, copyToClipboard, openModal, closeModal, refreshIcons };
})();
