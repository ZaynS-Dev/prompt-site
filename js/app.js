/* =====================================================
   app.js — VR Shoot Prompt Manager — Main Application
   ===================================================== */

const App = (() => {

  // ── State ──────────────────────────────────────────
  const state = {
    view: 'dashboard',
    layout: 'grid',
    search: '',
    sort: 'newest',
    filterPose: '',
    filterDress: '',
    editingId: null,
    pendingImages: [],   // { id, url, existing, cloudPath? }
    pendingTags: [],
    // History pagination
    historyPage: 1,
    historyHasMore: false,
    historyAction: '',
    historySearch: ''
  };

  /* ═══════════════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════════════ */
  async function init() {
    const s = Storage.getSettings();
    if (s.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    state.layout = s.layout || 'grid';

    // Init Supabase client
    SupabaseClient.init();

    bindEvents();
    populateCategorySelects();
    renderSidebarCategories();
    renderTagCloud();
    renderBadges();
    showView('dashboard');
    UI.refreshIcons();

    // Start cloud sync in background (non-blocking)
    if (AppConfig.ENABLE_CLOUD_SYNC) {
      setTimeout(async () => {
        await SyncManager.init();
        BackupManager.startAutoBackup();
        renderBadges();
        if (state.view === 'dashboard') renderDashboard();
        else if (state.view === 'settings') renderSettingsView();
      }, 500);
    } else {
      SyncManager.updateSyncUI();
    }
  }

  /* ═══════════════════════════════════════════════════
     EVENT BINDINGS
     ═══════════════════════════════════════════════════ */
  function bindEvents() {

    // Sidebar nav items (data-view)
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        clearFilters();
        showView(btn.dataset.view);
      });
    });

    // Group toggles (pose / dress collapse)
    document.querySelectorAll('.nav-group-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('collapsed');
        const group = btn.dataset.group;
        const list = document.getElementById(group === 'pose' ? 'poseList' : 'dressList');
        list.classList.toggle('collapsed');
      });
    });

    // Dashboard "view all" links
    document.querySelectorAll('[data-view-link]').forEach(btn => {
      btn.addEventListener('click', () => showView(btn.dataset.viewLink));
    });

    // Add prompt
    document.getElementById('btnAddPrompt').addEventListener('click', () => openPromptModal());
    document.getElementById('emptyAddBtn').addEventListener('click', () => openPromptModal());

    // Modal close buttons (all [data-close] targets)
    document.querySelectorAll('[data-close]').forEach(b => {
      b.addEventListener('click', e => {
        const id = e.currentTarget.dataset.close;
        UI.closeModal(id);
        if (id === 'promptModal') resetForm();
      });
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', debounce(e => {
      state.search = e.target.value.trim().toLowerCase();
      if (state.view === 'dashboard') showView('all');
      else renderPrompts();
    }, 200));

    // Filters
    document.getElementById('filterPose').addEventListener('change', e => { state.filterPose = e.target.value; renderPrompts(); });
    document.getElementById('filterDress').addEventListener('change', e => { state.filterDress = e.target.value; renderPrompts(); });
    document.getElementById('sortBy').addEventListener('change', e => { state.sort = e.target.value; renderPrompts(); });

    // Layout toggle
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.layout = btn.dataset.layout;
        Storage.setSettings({ layout: state.layout });
        document.getElementById('promptsGrid').classList.toggle('list-view', state.layout === 'list');
      });
    });

    // Prompt form
    document.getElementById('savePromptBtn').addEventListener('click', savePrompt);
    document.getElementById('fieldPrompt').addEventListener('input', e => {
      document.getElementById('promptCharCount').textContent = e.target.value.length;
    });

    // Image uploader (drag-drop)
    const uploader = document.getElementById('imageUploader');
    const imageInput = document.getElementById('imageInput');
    uploader.addEventListener('click', e => { if (!e.target.closest('.remove') && !e.target.closest('#addMoreBtn')) imageInput.click(); });
    imageInput.addEventListener('change', e => handleImageFiles(e.target.files));
    ['dragenter','dragover'].forEach(evt => uploader.addEventListener(evt, e => { e.preventDefault(); uploader.classList.add('drag-over'); }));
    ['dragleave','drop'].forEach(evt => uploader.addEventListener(evt, e => { e.preventDefault(); uploader.classList.remove('drag-over'); }));
    uploader.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files.length) handleImageFiles(e.dataTransfer.files); });

    // Add category buttons
    document.getElementById('addPoseBtn').addEventListener('click', async () => {
      const name = await UI.input({ title: 'Add Pose Category', label: 'Pose name', placeholder: 'e.g. Action Shot', okText: 'Add' });
      if (!name) return;
      if (Storage.addPose(name)) { populateCategorySelects(); document.getElementById('fieldPose').value = name; renderSidebarCategories(); UI.toast('Pose category added', 'success'); }
      else UI.toast('Category already exists', 'error');
    });
    document.getElementById('addDressBtn').addEventListener('click', async () => {
      const name = await UI.input({ title: 'Add Dress Category', label: 'Dress name', placeholder: 'e.g. Anarkali', okText: 'Add' });
      if (!name) return;
      if (Storage.addDress(name)) { populateCategorySelects(); document.getElementById('fieldDress').value = name; renderSidebarCategories(); UI.toast('Dress category added', 'success'); }
      else UI.toast('Category already exists', 'error');
    });

    // Tag input
    const tagInput = document.getElementById('fieldTagInput');
    tagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = tagInput.value.trim().replace(/^#/, '');
        if (val && !state.pendingTags.includes(val)) { state.pendingTags.push(val); renderPendingTags(); }
        tagInput.value = '';
      } else if (e.key === 'Backspace' && !tagInput.value && state.pendingTags.length) {
        state.pendingTags.pop(); renderPendingTags();
      }
    });

    // Detail modal
    document.getElementById('detailFavBtn').addEventListener('click', async () => {
      if (!state.editingId) return;
      const updated = Storage.toggleFavorite(state.editingId);
      const btn = document.getElementById('detailFavBtn');
      const icon = btn.querySelector('[data-lucide]');
      if (updated.isFavorite) { icon.setAttribute('fill','currentColor'); btn.style.color='var(--primary)'; UI.toast('Added to favorites','success'); }
      else { icon.removeAttribute('fill'); btn.style.color=''; UI.toast('Removed from favorites','info'); }
      // Log + sync
      await HistoryManager.log(updated.isFavorite ? HistoryManager.ACTIONS.FAVORITED : HistoryManager.ACTIONS.UNFAVORITED, updated);
      SyncManager.queueUpsert(updated);
      await SyncManager.drainQueue();
      renderBadges();
      if (state.view === 'dashboard') renderDashboard(); else renderPrompts();
    });
    document.getElementById('detailEditBtn').addEventListener('click', () => {
      const id = state.editingId;
      UI.closeModal('detailModal');
      openPromptModal(id);
    });
    document.getElementById('detailDeleteBtn').addEventListener('click', async () => {
      if (!state.editingId) return;
      const ok = await UI.confirm({ title: 'Delete prompt?', message: 'This will be soft-deleted and can be seen in History.', okText: 'Delete' });
      if (!ok) return;
      const p = Storage.getPrompt(state.editingId);
      await HistoryManager.log(HistoryManager.ACTIONS.DELETED, p, { prompt: p.prompt });
      SyncManager.queueDelete(state.editingId);
      await Storage.deletePrompt(state.editingId);
      await SyncManager.drainQueue();
      UI.closeModal('detailModal');
      UI.toast('Prompt deleted', 'success');
      refreshAll();
    });

    // Export / Import (sidebar quick buttons)
    document.getElementById('btnExport').addEventListener('click', exportData);
    document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importFile').click());
    document.getElementById('importFile').addEventListener('change', importData);

    // Theme
    document.getElementById('btnTheme').addEventListener('click', toggleTheme);

    // Mobile sidebar
    document.getElementById('menuBtn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.add('open');
      document.getElementById('app').classList.add('sidebar-open');
    });
    document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
    document.getElementById('app').addEventListener('click', e => {
      if (e.target === e.currentTarget && document.getElementById('sidebar').classList.contains('open')) closeSidebar();
    });

    // Lightbox
    document.getElementById('lbPrev').addEventListener('click', () => navigateLightbox(-1));
    document.getElementById('lbNext').addEventListener('click', () => navigateLightbox(1));

    // Sync indicator click → popup
    document.getElementById('syncIndicator').addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('syncPopup').classList.toggle('hidden');
      SyncManager.updateSyncUI();
    });
    document.addEventListener('click', () => document.getElementById('syncPopup').classList.add('hidden'));
    document.getElementById('syncPopup').addEventListener('click', e => e.stopPropagation());
    document.getElementById('btnSyncNow').addEventListener('click', async () => {
      document.getElementById('syncPopup').classList.add('hidden');
      await SyncManager.syncNow();
      if (state.view === 'dashboard') renderDashboard();
    });

    // History
    document.getElementById('historyActionFilter').addEventListener('change', e => {
      state.historyAction = e.target.value; state.historyPage = 1; loadHistory(true);
    });
    document.getElementById('historySearch').addEventListener('input', debounce(e => {
      state.historySearch = e.target.value.trim(); state.historyPage = 1; loadHistory(true);
    }, 300));
    document.getElementById('btnLoadMore').addEventListener('click', () => {
      state.historyPage++; loadHistory(false);
    });

    // Settings: cloud sync
    document.getElementById('btnTestConnection').addEventListener('click', testConnection);
    document.getElementById('btnSyncNowSettings').addEventListener('click', async () => {
      await SyncManager.syncNow();
      renderSettingsView();
    });
    document.getElementById('toggleCloudSync').addEventListener('change', e => {
      Storage.setSettings({ cloudSyncEnabled: e.target.checked });
      UI.toast(e.target.checked ? 'Cloud sync enabled' : 'Cloud sync disabled', 'info');
    });

    // Settings: backup
    document.getElementById('btnBackupNow').addEventListener('click', async () => {
      await BackupManager.createBackup('manual', true);
      renderBackupList();
      renderSettingsView();
    });
    document.getElementById('btnExportJSON').addEventListener('click', exportData);
    document.getElementById('btnImportJSON').addEventListener('click', () => document.getElementById('importFileSettings').click());
    document.getElementById('importFileSettings').addEventListener('change', importData);
    document.getElementById('toggleAutoBackup').addEventListener('change', e => {
      BackupManager.setAutoEnabled(e.target.checked);
      UI.toast(e.target.checked ? 'Auto-backup enabled' : 'Auto-backup disabled', 'info');
    });

    // Settings: history
    document.getElementById('btnClearHistory').addEventListener('click', async () => {
      const days = +document.getElementById('clearHistoryDays').value;
      const ok = await UI.confirm({ title: `Clear history older than ${days} days?`, message: 'This removes old action logs from Supabase.', okText: 'Clear', danger: false });
      if (!ok) return;
      const done = await HistoryManager.clearOlderThan(days);
      if (done) { UI.toast(`History older than ${days} days cleared`, 'success'); renderSettingsView(); }
      else UI.toast('Could not clear history (offline?)', 'error');
    });
    document.getElementById('btnExportHistoryCSV').addEventListener('click', exportHistoryCSV);

    // Settings: danger zone
    document.getElementById('btnClearLocal').addEventListener('click', async () => {
      const ok = await UI.confirm({ title: 'Clear all local data?', message: 'Your cloud data will remain. The page will reload.', okText: 'Clear Local', danger: true });
      if (!ok) return;
      localStorage.clear();
      indexedDB.deleteDatabase('vrshoot-db');
      UI.toast('Local data cleared — reloading…', 'info', 1500);
      setTimeout(() => location.reload(), 1600);
    });
    document.getElementById('btnDeleteCloud').addEventListener('click', async () => {
      const ok1 = await UI.confirm({ title: 'Delete ALL cloud data?', message: 'This deletes everything from Supabase. Cannot be undone.', okText: 'Yes, delete', danger: true });
      if (!ok1) return;
      const ok2 = await UI.confirm({ title: 'Are you absolutely sure?', message: 'Type DELETE to confirm — all cloud prompts, history and backups will be gone forever.', okText: 'DELETE CLOUD DATA', danger: true });
      if (!ok2) return;
      UI.toast('Deleting cloud data…', 'info', 2000);
      const done = await SyncManager.deleteAllCloudData();
      if (done) UI.toast('Cloud data deleted', 'success'); else UI.toast('Delete failed', 'error');
    });
    document.getElementById('btnResetAll').addEventListener('click', async () => {
      const ok = await UI.confirm({ title: 'Reset everything?', message: 'Deletes ALL local and cloud data. The app will be wiped clean.', okText: 'Reset Everything', danger: true });
      if (!ok) return;
      await SyncManager.deleteAllCloudData();
      localStorage.clear();
      indexedDB.deleteDatabase('vrshoot-db');
      UI.toast('App reset — reloading…', 'info', 1500);
      setTimeout(() => location.reload(), 1600);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      const inForm = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal:not(.hidden), .lightbox:not(.hidden)').forEach(m => m.classList.add('hidden'));
        document.getElementById('syncPopup').classList.add('hidden');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !inForm) { e.preventDefault(); openPromptModal(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); document.getElementById('searchInput').focus(); document.getElementById('searchInput').select(); }
      if (!document.getElementById('lightbox').classList.contains('hidden')) {
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
      }
    });
  }

  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('app').classList.remove('sidebar-open');
  }

  /* ═══════════════════════════════════════════════════
     VIEW MANAGEMENT
     ═══════════════════════════════════════════════════ */
  function showView(view) {
    state.view = view;
    closeSidebar();

    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.nav-sub-item').forEach(b => b.classList.remove('active'));

    const views = ['viewDashboard','viewPrompts','viewHistory','viewSettings'];
    views.forEach(id => document.getElementById(id).classList.add('hidden'));

    if (['dashboard','all','favorites','history','settings'].includes(view)) {
      const btn = document.querySelector(`.nav-item[data-view="${view}"]`);
      if (btn) btn.classList.add('active');
    }

    switch (view) {
      case 'dashboard':
        document.getElementById('viewDashboard').classList.remove('hidden');
        renderDashboard(); break;
      case 'history':
        document.getElementById('viewHistory').classList.remove('hidden');
        state.historyPage = 1; loadHistory(true); break;
      case 'settings':
        document.getElementById('viewSettings').classList.remove('hidden');
        renderSettingsView(); break;
      default:
        document.getElementById('viewPrompts').classList.remove('hidden');
        updatePromptsTitle(); renderPrompts(); break;
    }
    UI.refreshIcons();
  }

  function updatePromptsTitle() {
    const titleEl = document.getElementById('promptsTitle');
    let title = 'All Prompts';
    if (state.view === 'favorites') title = 'Favorites';
    else if (state.view.startsWith('pose:'))  title = `Pose: ${state.view.slice(5)}`;
    else if (state.view.startsWith('dress:')) title = `Dress: ${state.view.slice(6)}`;
    else if (state.view.startsWith('tag:'))   title = `Tag: #${state.view.slice(4)}`;
    titleEl.textContent = title;
  }

  function clearFilters() {
    state.filterPose = ''; state.filterDress = '';
    const fp = document.getElementById('filterPose');
    const fd = document.getElementById('filterDress');
    if (fp) fp.value = ''; if (fd) fd.value = '';
  }

  /* ═══════════════════════════════════════════════════
     SIDEBAR RENDER
     ═══════════════════════════════════════════════════ */
  function renderSidebarCategories() {
    const prompts = Storage.getPrompts();
    const poses = Storage.getPoses();
    const poseEl = document.getElementById('poseList');
    poseEl.innerHTML = poses.map(p => {
      const count = prompts.filter(x => x.poseCategory === p).length;
      return `<button class="nav-sub-item ${state.view==='pose:'+p?'active':''}" data-pose="${esc(p)}"><span>${esc(p)}</span><span class="badge">${count}</span></button>`;
    }).join('');
    poseEl.querySelectorAll('[data-pose]').forEach(b => b.addEventListener('click', () => { clearFilters(); showView('pose:'+b.dataset.pose); }));

    const dresses = Storage.getDresses();
    const dressEl = document.getElementById('dressList');
    dressEl.innerHTML = dresses.map(d => {
      const count = prompts.filter(x => x.dressCategory === d).length;
      return `<button class="nav-sub-item ${state.view==='dress:'+d?'active':''}" data-dress="${esc(d)}"><span>${esc(d)}</span><span class="badge">${count}</span></button>`;
    }).join('');
    dressEl.querySelectorAll('[data-dress]').forEach(b => b.addEventListener('click', () => { clearFilters(); showView('dress:'+b.dataset.dress); }));
  }

  function renderTagCloud() {
    const prompts = Storage.getPrompts();
    const tagCount = {};
    prompts.forEach(p => (p.tags||[]).forEach(t => { tagCount[t]=(tagCount[t]||0)+1; }));
    const tags = Object.entries(tagCount).sort((a,b)=>b[1]-a[1]).slice(0,30);
    const el = document.getElementById('tagCloud');
    if (!tags.length) { el.innerHTML='<span class="muted">No tags yet</span>'; return; }
    el.innerHTML = tags.map(([t,c]) => `<span class="tag-chip ${state.view==='tag:'+t?'active':''}" data-tag="${esc(t)}">#${esc(t)} <small>(${c})</small></span>`).join('');
    el.querySelectorAll('[data-tag]').forEach(s => s.addEventListener('click', () => { clearFilters(); showView('tag:'+s.dataset.tag); }));
  }

  function renderBadges() {
    const prompts = Storage.getPrompts();
    document.getElementById('badgeAll').textContent = prompts.length;
    document.getElementById('badgeFav').textContent = prompts.filter(p=>p.isFavorite).length;
  }

  function populateCategorySelects() {
    const poses = Storage.getPoses();
    const dresses = Storage.getDresses();
    document.getElementById('filterPose').innerHTML = '<option value="">All Poses</option>' + poses.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
    document.getElementById('filterDress').innerHTML = '<option value="">All Dresses</option>' + dresses.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');
    document.getElementById('fieldPose').innerHTML  = '<option value="">— None —</option>' + poses.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
    document.getElementById('fieldDress').innerHTML = '<option value="">— None —</option>' + dresses.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');
  }

  /* ═══════════════════════════════════════════════════
     DASHBOARD
     ═══════════════════════════════════════════════════ */
  function renderDashboard() {
    const prompts = Storage.getPrompts();
    const total = prompts.length;
    const favCount = prompts.filter(p=>p.isFavorite).length;
    const usageTotal = prompts.reduce((s,p)=>s+(p.usageCount||0),0);
    const mostUsedPose = mostCommon(prompts.map(p=>p.poseCategory).filter(Boolean));
    const mostUsedDress = mostCommon(prompts.map(p=>p.dressCategory).filter(Boolean));
    const syncStatus = SyncManager.getStatus();

    const stats = [
      { icon:'layers',    label:'Total Prompts',   value:total,                   accent:true },
      { icon:'star',      label:'Favorites',        value:favCount                            },
      { icon:'copy',      label:'Times Copied',     value:usageTotal                          },
      { icon:'sparkles',  label:'Top Pose',         value:mostUsedPose||'—'                   },
      { icon:'shirt',     label:'Top Dress',        value:mostUsedDress||'—'                  },
      { icon:'cloud',     label:'Cloud',            value:syncStatus==='synced'?'Synced':syncStatus==='syncing'?'Syncing…':syncStatus==='error'?'Error':'Offline' }
    ];

    document.getElementById('statsGrid').innerHTML = stats.map(s=>`
      <div class="stat-card ${s.accent?'accent':''}">
        <div class="stat-icon"><i data-lucide="${s.icon}"></i></div>
        <div class="stat-info">
          <span class="stat-label">${esc(s.label)}</span>
          <span class="stat-value">${esc(String(s.value))}</span>
        </div>
      </div>`).join('');

    const recent = [...prompts].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5);
    const favorites = prompts.filter(p=>p.isFavorite).slice(0,5);
    renderMiniList('recentList', recent, 'No prompts yet — add your first one!');
    renderMiniList('favoritesList', favorites, 'No favorites yet — star a prompt to see it here.');
    UI.refreshIcons();
  }

  function renderMiniList(containerId, items, emptyMsg) {
    const el = document.getElementById(containerId);
    if (!items.length) { el.innerHTML=`<div class="empty-msg">${esc(emptyMsg)}</div>`; return; }
    el.innerHTML = items.map(p=>`
      <div class="mini-prompt" data-id="${p.id}">
        <div class="mini-thumb" id="mini-${p.id}"><i data-lucide="image"></i></div>
        <div class="mini-info">
          <div class="mini-title">${esc(p.title)}</div>
          <div class="mini-meta">
            ${p.poseCategory?`<span>${esc(p.poseCategory)}</span>`:''}
            ${p.dressCategory?`<span>· ${esc(p.dressCategory)}</span>`:''}
            <span>· ${UI.formatDate(p.createdAt)}</span>
          </div>
        </div>
      </div>`).join('');
    el.querySelectorAll('.mini-prompt').forEach(card => card.addEventListener('click', () => openDetailModal(card.dataset.id)));
    items.forEach(async p => {
      const target = document.getElementById(`mini-${p.id}`);
      if (target && p.images && p.images.length) {
        const url = await Storage.getImageUrl(p.images[0]);
        if (url && target) { target.style.backgroundImage=`url(${url})`; target.innerHTML=''; }
      }
    });
  }

  /* ═══════════════════════════════════════════════════
     PROMPTS GRID
     ═══════════════════════════════════════════════════ */
  function renderPrompts() {
    const list = getFilteredPrompts();
    renderActiveFilters();
    document.getElementById('resultsCount').textContent = list.length;
    const grid = document.getElementById('promptsGrid');
    const empty = document.getElementById('emptyState');
    grid.classList.toggle('list-view', state.layout==='list');
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.layout===state.layout));

    if (!list.length) {
      grid.innerHTML=''; empty.classList.remove('hidden');
      const hasFilters = state.search || state.filterPose || state.filterDress;
      empty.querySelector('h2').textContent = Storage.getPrompts().length===0 ? 'No prompts yet' : 'No matching prompts';
      empty.querySelector('p').textContent  = Storage.getPrompts().length===0
        ? 'Start building your AI fashion photography library by adding your first prompt.'
        : 'Try adjusting your search or filters.';
      UI.refreshIcons(); return;
    }
    empty.classList.add('hidden');
    grid.innerHTML = list.map(p => promptCardHTML(p)).join('');

    grid.querySelectorAll('.prompt-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.card-actions') || e.target.closest('.card-fav')) return;
        openDetailModal(card.dataset.id);
      });
    });
    grid.querySelectorAll('.card-fav').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const updated = Storage.toggleFavorite(id);
        UI.toast(updated.isFavorite?'Added to favorites':'Removed from favorites','success');
        await HistoryManager.log(updated.isFavorite?HistoryManager.ACTIONS.FAVORITED:HistoryManager.ACTIONS.UNFAVORITED, updated);
        SyncManager.queueUpsert(updated); SyncManager.drainQueue();
        renderBadges(); renderPrompts();
      });
    });
    grid.querySelectorAll('.action-copy').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const p = Storage.getPrompt(btn.dataset.id);
        if (!p) return;
        const ok = await UI.copyToClipboard(p.prompt);
        if (ok) {
          Storage.incrementUsage(p.id);
          const updated = Storage.getPrompt(p.id);
          await HistoryManager.log(HistoryManager.ACTIONS.USED, updated);
          SyncManager.queueUpsert(updated); SyncManager.drainQueue();
          UI.toast('Prompt copied!','success');
        } else UI.toast('Copy failed','error');
      });
    });
    grid.querySelectorAll('.action-view').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openDetailModal(btn.dataset.id); }));
    grid.querySelectorAll('.action-edit').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openPromptModal(btn.dataset.id); }));
    grid.querySelectorAll('.action-delete').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const ok = await UI.confirm({ title:'Delete prompt?', message:'This will be soft-deleted. You can see it in History.', okText:'Delete' });
        if (!ok) return;
        const p = Storage.getPrompt(id);
        await HistoryManager.log(HistoryManager.ACTIONS.DELETED, p, { prompt: p.prompt });
        SyncManager.queueDelete(id);
        await Storage.deletePrompt(id);
        SyncManager.drainQueue();
        UI.toast('Prompt deleted','success');
        refreshAll();
      });
    });

    // Load thumbnails async
    list.forEach(async p => {
      const thumb = document.getElementById(`thumb-${p.id}`);
      if (thumb && p.images && p.images.length) {
        const url = await Storage.getImageUrl(p.images[0]);
        if (url && thumb) { thumb.style.backgroundImage=`url(${url})`; const ph=thumb.querySelector('.thumb-placeholder'); if(ph)ph.remove(); }
      }
    });
    UI.refreshIcons();
  }

  function promptCardHTML(p) {
    const tagsHtml = (p.tags||[]).slice(0,4).map(t=>`<span class="tag-pill">#${esc(t)}</span>`).join('');
    const moreTags = (p.tags||[]).length>4 ? `<span class="tag-pill">+${p.tags.length-4}</span>` : '';
    return `
      <article class="prompt-card" data-id="${p.id}">
        <div class="card-thumb" id="thumb-${p.id}">
          <div class="thumb-placeholder"><i data-lucide="image"></i></div>
          <button class="card-fav ${p.isFavorite?'active':''}" data-id="${p.id}" aria-label="Toggle favorite">
            <i data-lucide="star"></i>
          </button>
          ${p.images&&p.images.length>1?`<span class="img-count"><i data-lucide="images"></i>${p.images.length}</span>`:''}
        </div>
        <div class="card-body">
          <h3 class="card-title">${esc(p.title)}</h3>
          <div class="card-chips">
            ${p.poseCategory?`<span class="chip chip-pose">${esc(p.poseCategory)}</span>`:''}
            ${p.dressCategory?`<span class="chip chip-dress">${esc(p.dressCategory)}</span>`:''}
          </div>
          ${tagsHtml||moreTags?`<div class="card-tags">${tagsHtml}${moreTags}</div>`:''}
        </div>
        <div class="card-actions">
          <button class="card-action-btn primary action-copy" data-id="${p.id}"><i data-lucide="copy"></i> Copy</button>
          <button class="card-action-btn action-view" data-id="${p.id}" title="Details"><i data-lucide="eye"></i></button>
          <button class="card-action-btn action-edit" data-id="${p.id}" title="Edit"><i data-lucide="pencil"></i></button>
          <button class="card-action-btn action-delete" data-id="${p.id}" title="Delete"><i data-lucide="trash-2"></i></button>
        </div>
      </article>`;
  }

  function renderActiveFilters() {
    const container = document.getElementById('activeFilters');
    const chips = [];
    if (state.view.startsWith('pose:'))  chips.push({ label:`Pose: ${state.view.slice(5)}`,  action:()=>showView('all') });
    if (state.view.startsWith('dress:')) chips.push({ label:`Dress: ${state.view.slice(6)}`, action:()=>showView('all') });
    if (state.view.startsWith('tag:'))   chips.push({ label:`#${state.view.slice(4)}`,        action:()=>showView('all') });
    if (state.view==='favorites')        chips.push({ label:'Favorites only',                  action:()=>showView('all') });
    if (state.search)                    chips.push({ label:`Search: "${state.search}"`, action:()=>{ state.search=''; document.getElementById('searchInput').value=''; renderPrompts(); } });
    if (state.filterPose)  chips.push({ label:`Pose: ${state.filterPose}`,   action:()=>{ state.filterPose='';  document.getElementById('filterPose').value='';  renderPrompts(); } });
    if (state.filterDress) chips.push({ label:`Dress: ${state.filterDress}`, action:()=>{ state.filterDress=''; document.getElementById('filterDress').value=''; renderPrompts(); } });
    container.innerHTML = chips.map((c,i)=>`<span class="filter-chip">${esc(c.label)}<button data-i="${i}" aria-label="Remove"><i data-lucide="x"></i></button></span>`).join('');
    container.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', ()=>chips[+b.dataset.i].action()));
  }

  function getFilteredPrompts() {
    let list = Storage.getPrompts();
    if (state.view==='favorites') list=list.filter(p=>p.isFavorite);
    else if (state.view.startsWith('pose:'))  list=list.filter(p=>p.poseCategory===state.view.slice(5));
    else if (state.view.startsWith('dress:')) list=list.filter(p=>p.dressCategory===state.view.slice(6));
    else if (state.view.startsWith('tag:'))   { const tag=state.view.slice(4); list=list.filter(p=>(p.tags||[]).includes(tag)); }
    if (state.filterPose)  list=list.filter(p=>p.poseCategory===state.filterPose);
    if (state.filterDress) list=list.filter(p=>p.dressCategory===state.filterDress);
    if (state.search) {
      const q=state.search;
      list=list.filter(p=>(p.title||'').toLowerCase().includes(q)||(p.prompt||'').toLowerCase().includes(q)||(p.notes||'').toLowerCase().includes(q)||(p.tags||[]).some(t=>t.toLowerCase().includes(q))||(p.poseCategory||'').toLowerCase().includes(q)||(p.dressCategory||'').toLowerCase().includes(q));
    }
    switch(state.sort) {
      case 'oldest':      list.sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)); break;
      case 'most-used':   list.sort((a,b)=>(b.usageCount||0)-(a.usageCount||0)); break;
      case 'recent-used': list.sort((a,b)=>new Date(b.lastUsedAt||0)-new Date(a.lastUsedAt||0)); break;
      default:            list.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)); break;
    }
    return list;
  }

  /* ═══════════════════════════════════════════════════
     HISTORY VIEW
     ═══════════════════════════════════════════════════ */
  async function loadHistory(reset=true) {
    const loadingEl = document.getElementById('historyLoading');
    const emptyEl   = document.getElementById('historyEmpty');
    const entriesEl = document.getElementById('historyEntries');
    const moreEl    = document.getElementById('historyMore');

    loadingEl.classList.remove('hidden');
    if (reset) { entriesEl.innerHTML=''; moreEl.classList.add('hidden'); }

    if (!SupabaseClient.isReady()) {
      loadingEl.classList.add('hidden');
      emptyEl.classList.remove('hidden');
      emptyEl.querySelector('h3').textContent = 'Cloud not connected';
      emptyEl.querySelector('p').textContent = 'Run supabase_setup.sql and refresh to enable history.';
      return;
    }

    const { entries, hasMore } = await HistoryManager.fetch({
      page: state.historyPage,
      action: state.historyAction,
      search: state.historySearch
    });

    loadingEl.classList.add('hidden');
    state.historyHasMore = hasMore;

    if (reset && !entries.length) {
      emptyEl.classList.remove('hidden');
      emptyEl.querySelector('h3').textContent = 'No history yet';
      emptyEl.querySelector('p').textContent = 'Actions you take will appear here.';
      return;
    }
    emptyEl.classList.add('hidden');
    entriesEl.insertAdjacentHTML('beforeend', entries.map(e => historyEntryHTML(e)).join(''));
    moreEl.classList.toggle('hidden', !hasMore);
    UI.refreshIcons();
  }

  function historyEntryHTML(entry) {
    const meta = HistoryManager.ACTION_META[entry.action] || { icon:'activity', label:entry.action, color:'var(--primary)' };
    return `
      <div class="history-entry">
        <div class="history-line"></div>
        <div class="history-icon" style="color:${meta.color};border-color:${meta.color}20;background:${meta.color}10">
          <i data-lucide="${meta.icon}"></i>
        </div>
        <div class="history-content">
          <div class="history-title">
            <strong>${esc(entry.prompt_title || 'Unknown prompt')}</strong>
            <span class="history-action-badge" style="background:${meta.color}15;color:${meta.color}">${meta.label}</span>
          </div>
          <div class="history-time muted">${UI.formatDate(entry.created_at)}</div>
          ${entry.action==='deleted' && entry.details?.prompt ? `
            <div class="history-restore-wrap">
              <button class="btn btn-ghost btn-sm history-restore-btn" data-entry='${JSON.stringify({id:entry.prompt_id,title:entry.prompt_title,details:entry.details})}'>
                <i data-lucide="rotate-ccw"></i> Restore
              </button>
            </div>` : ''}
        </div>
      </div>`;
  }

  // Delegate restore button click
  document.addEventListener('click', async e => {
    const btn = e.target.closest('.history-restore-btn');
    if (!btn) return;
    try {
      const data = JSON.parse(btn.dataset.entry);
      const ok = await UI.confirm({ title:'Restore this prompt?', message:`"${data.title}" will be re-added to your library.`, okText:'Restore', danger:false });
      if (!ok) return;
      // Re-create locally
      const restored = Storage.addPrompt({
        title: data.title,
        prompt: data.details?.prompt || '',
        tags: [], images: []
      });
      await HistoryManager.log(HistoryManager.ACTIONS.RESTORED, restored);
      SyncManager.queueUpsert(restored); SyncManager.drainQueue();
      UI.toast(`"${data.title}" restored`, 'success');
      refreshAll();
    } catch(err) { UI.toast('Restore failed','error'); }
  });

  /* ═══════════════════════════════════════════════════
     SETTINGS VIEW
     ═══════════════════════════════════════════════════ */
  async function renderSettingsView() {
    // Connection badge
    const badge = document.getElementById('connectionBadge');
    const isConnected = SupabaseClient.isReady() && navigator.onLine;
    badge.textContent = isConnected ? 'Connected' : 'Disconnected';
    badge.className   = 'connection-badge ' + (isConnected ? 'connected' : 'disconnected');

    // Sync stats
    const lastSync = SyncManager.getLastSync();
    document.getElementById('settingsLastSync').textContent = lastSync ? UI.formatDate(lastSync.toISOString()) : 'Never';
    document.getElementById('syncedCount').textContent = Storage.getPrompts().length;

    // Toggle states
    const settings = Storage.getSettings();
    document.getElementById('toggleCloudSync').checked  = settings.cloudSyncEnabled !== false;
    document.getElementById('toggleAutoBackup').checked = BackupManager.isAutoEnabled();

    // Backup stats
    const bStats = await BackupManager.getStats();
    document.getElementById('backupCount').textContent    = bStats.count;
    document.getElementById('backupStorageKb').textContent = bStats.totalKb > 1024 ? `${(bStats.totalKb/1024).toFixed(1)} MB` : `${bStats.totalKb} KB`;
    const lastBackup = BackupManager.getLastBackupAt();
    document.getElementById('lastBackupTime').textContent = lastBackup ? UI.formatDate(lastBackup) : 'Never';

    // History count
    const histTotal = await HistoryManager.getTotalCount();
    document.getElementById('historyTotalCount').textContent = histTotal;

    // Backup list
    await renderBackupList();
    UI.refreshIcons();
  }

  async function renderBackupList() {
    const list = await BackupManager.listBackups();
    const el = document.getElementById('backupList');
    if (!list.length) { el.innerHTML = '<div class="muted" style="padding:16px">No cloud backups yet — click "Backup Now" to create one.</div>'; return; }
    el.innerHTML = list.map(b => `
      <div class="backup-row">
        <div class="backup-info">
          <span class="backup-type ${b.backup_type}">${b.backup_type==='auto'?'Auto':'Manual'}</span>
          <span class="backup-date">${UI.formatDate(b.created_at)}</span>
          <span class="muted">${b.prompts_count||0} prompts · ${b.backup_size_kb||0} KB</span>
        </div>
        <div class="backup-actions">
          <button class="btn btn-ghost btn-sm backup-download" data-id="${b.id}" title="Download JSON"><i data-lucide="download"></i></button>
          <button class="btn btn-ghost btn-sm backup-restore"  data-id="${b.id}"><i data-lucide="rotate-ccw"></i> Restore</button>
        </div>
      </div>`).join('');
    el.querySelectorAll('.backup-restore').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await UI.confirm({ title:'Restore this backup?', message:'Current local data will be replaced with this backup.', okText:'Restore', danger:false });
        if (!ok) return;
        const done = await BackupManager.restoreBackup(btn.dataset.id);
        if (done) { refreshAll(); renderSettingsView(); }
      });
    });
    el.querySelectorAll('.backup-download').forEach(btn => {
      btn.addEventListener('click', () => BackupManager.downloadBackup(btn.dataset.id));
    });
    UI.refreshIcons();
  }

  async function testConnection() {
    const btn = document.getElementById('btnTestConnection');
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> Testing…'; UI.refreshIcons();
    try {
      if (!SupabaseClient.isReady()) throw new Error('Client not initialized');
      const { error } = await SupabaseClient.get().from('prompts').select('id').limit(1);
      if (error) throw error;
      UI.toast('Connection successful ✓', 'success');
    } catch (err) {
      UI.toast('Connection failed: ' + err.message, 'error');
    }
    btn.disabled = false; btn.innerHTML = '<i data-lucide="wifi"></i> Test Connection'; UI.refreshIcons();
  }

  async function exportHistoryCSV() {
    const entries = await HistoryManager.fetchAll();
    if (!entries.length) { UI.toast('No history to export', 'info'); return; }
    const rows = [['ID','Action','Prompt Title','Prompt ID','Created At'].join(',')];
    entries.forEach(e => rows.push([e.id, e.action, `"${(e.prompt_title||'').replace(/"/g,'""')}"`, e.prompt_id||'', e.created_at].join(',')));
    const blob = new Blob([rows.join('\n')], { type:'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download=`vrshoot-history-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    UI.toast('History exported as CSV', 'success');
  }

  /* ═══════════════════════════════════════════════════
     PROMPT MODAL (ADD / EDIT)
     ═══════════════════════════════════════════════════ */
  async function openPromptModal(id=null) {
    state.editingId = id;
    state.pendingImages = [];
    state.pendingTags = [];
    document.getElementById('promptModalTitle').textContent = id ? 'Edit Prompt' : 'Add New Prompt';
    document.getElementById('promptId').value = id || '';

    if (id) {
      const p = Storage.getPrompt(id);
      if (!p) return;
      document.getElementById('fieldTitle').value    = p.title||'';
      document.getElementById('fieldPrompt').value   = p.prompt||'';
      document.getElementById('promptCharCount').textContent = (p.prompt||'').length;
      document.getElementById('fieldNegative').value = p.negativePrompt||'';
      document.getElementById('fieldPose').value     = p.poseCategory||'';
      document.getElementById('fieldDress').value    = p.dressCategory||'';
      document.getElementById('fieldNotes').value    = p.notes||'';
      document.getElementById('fieldFavorite').checked = !!p.isFavorite;
      state.pendingTags = [...(p.tags||[])];
      for (const imgId of (p.images||[])) {
        const url = await Storage.getImageUrl(imgId);
        if (url) state.pendingImages.push({ id:imgId, url, existing:true });
      }
    } else {
      resetForm();
    }
    renderPendingImages();
    renderPendingTags();
    renderTagSuggestions();
    UI.openModal('promptModal');
    setTimeout(() => document.getElementById('fieldTitle').focus(), 100);
  }

  function resetForm() {
    document.getElementById('promptForm').reset();
    document.getElementById('promptCharCount').textContent='0';
    document.getElementById('promptId').value='';
    state.editingId=null; state.pendingImages=[]; state.pendingTags=[];
    renderPendingImages(); renderPendingTags();
  }

  async function handleImageFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const blob = await Storage.compressImage(file, AppConfig.IMAGE_MAX_DIM, AppConfig.IMAGE_QUALITY);
        const id = Storage.uuid();
        await Storage.saveImage(id, blob);
        const url = URL.createObjectURL(blob);
        state.pendingImages.push({ id, url, existing:false, blob });
        renderPendingImages();
        // Upload to Supabase Storage in background
        const promptId = state.editingId || 'pending';
        ImageUploader.uploadBlob(blob, promptId).then(result => {
          if (result) {
            const img = state.pendingImages.find(i=>i.id===id);
            if (img) { img.cloudPath=result.path; img.cloudUrl=result.url; }
          }
        });
      } catch(err) { console.error(err); UI.toast('Failed to process image','error'); }
    }
    document.getElementById('imageInput').value='';
  }

  function renderPendingImages() {
    const grid  = document.getElementById('uploaderGrid');
    const empty = document.getElementById('uploaderEmpty');
    if (!state.pendingImages.length) { grid.innerHTML=''; empty.style.display=''; return; }
    empty.style.display='none';
    grid.innerHTML = state.pendingImages.map((img,i)=>`
      <div class="uploader-thumb">
        <img src="${img.url}" alt="ref ${i+1}" />
        <button type="button" class="remove" data-i="${i}" aria-label="Remove"><i data-lucide="x"></i></button>
      </div>`).join('') +
      `<button type="button" id="addMoreBtn" class="uploader-thumb"><span class="add-more"><i data-lucide="plus"></i></span></button>`;
    grid.querySelectorAll('.remove').forEach(b => {
      b.addEventListener('click', async e => {
        e.stopPropagation();
        const i = +b.dataset.i;
        const img = state.pendingImages[i];
        if (!img.existing) await Storage.deleteImage(img.id);
        if (img.cloudPath) ImageUploader.deleteByPath(img.cloudPath);
        state.pendingImages.splice(i,1);
        renderPendingImages();
      });
    });
    document.getElementById('addMoreBtn').addEventListener('click', e => { e.stopPropagation(); document.getElementById('imageInput').click(); });
    UI.refreshIcons();
  }

  function renderPendingTags() {
    const el = document.getElementById('tagList');
    el.innerHTML = state.pendingTags.map((t,i)=>`<span class="tag-item">#${esc(t)} <button type="button" data-i="${i}"><i data-lucide="x"></i></button></span>`).join('');
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', ()=>{ state.pendingTags.splice(+b.dataset.i,1); renderPendingTags(); }));
    UI.refreshIcons();
  }

  function renderTagSuggestions() {
    const unused = Storage.getTags().filter(t=>!state.pendingTags.includes(t)).slice(0,12);
    const el = document.getElementById('tagSuggestions');
    if (!unused.length) { el.innerHTML=''; return; }
    el.innerHTML = unused.map(t=>`<button type="button" class="suggestion" data-tag="${esc(t)}">#${esc(t)}</button>`).join('');
    el.querySelectorAll('.suggestion').forEach(b => {
      b.addEventListener('click', ()=>{ if(!state.pendingTags.includes(b.dataset.tag)) state.pendingTags.push(b.dataset.tag); renderPendingTags(); renderTagSuggestions(); });
    });
  }

  async function savePrompt() {
    const title      = document.getElementById('fieldTitle').value.trim();
    const promptText = document.getElementById('fieldPrompt').value.trim();
    if (!title) { UI.toast('Title is required','error'); return; }
    if (!promptText) { UI.toast('Prompt text is required','error'); return; }

    const data = {
      title, prompt: promptText,
      negativePrompt: document.getElementById('fieldNegative').value.trim(),
      poseCategory:   document.getElementById('fieldPose').value,
      dressCategory:  document.getElementById('fieldDress').value,
      tags:           [...state.pendingTags],
      notes:          document.getElementById('fieldNotes').value.trim(),
      isFavorite:     document.getElementById('fieldFavorite').checked,
      images:         state.pendingImages.map(i=>i.id)
    };

    let saved;
    if (state.editingId) {
      const existing = Storage.getPrompt(state.editingId);
      const newIds   = new Set(data.images);
      const removed  = (existing.images||[]).filter(id=>!newIds.has(id));
      await Promise.all(removed.map(id=>Storage.deleteImage(id)));
      saved = Storage.updatePrompt(state.editingId, data);
      await HistoryManager.log(HistoryManager.ACTIONS.UPDATED, saved);
      UI.toast('Prompt updated','success');
    } else {
      saved = Storage.addPrompt(data);
      await HistoryManager.log(HistoryManager.ACTIONS.CREATED, saved);
      UI.toast('Prompt saved!','success');
    }

    // Save image records to Supabase
    if (SupabaseClient.isReady()) {
      await ImageUploader.deleteRecordsByPrompt(saved.id);
      for (let i=0; i<state.pendingImages.length; i++) {
        const img = state.pendingImages[i];
        let url  = img.cloudUrl  || null;
        let path = img.cloudPath || null;
        if (!url && img.blob) {
          const result = await ImageUploader.uploadBlob(img.blob, saved.id);
          if (result) { url=result.url; path=result.path; }
        }
        if (url && path) await ImageUploader.saveImageRecord(saved.id, url, path, i);
      }
    }

    SyncManager.queueUpsert(saved);
    await SyncManager.drainQueue();

    UI.closeModal('promptModal');
    resetForm();
    refreshAll();
  }

  /* ═══════════════════════════════════════════════════
     DETAIL MODAL
     ═══════════════════════════════════════════════════ */
  async function openDetailModal(id) {
    const p = Storage.getPrompt(id);
    if (!p) return;
    state.editingId = id;

    document.getElementById('detailTitle').textContent = p.title;
    const favBtn  = document.getElementById('detailFavBtn');
    const favIcon = favBtn.querySelector('[data-lucide]');
    if (p.isFavorite) { favIcon.setAttribute('fill','currentColor'); favBtn.style.color='var(--primary)'; }
    else { favIcon.removeAttribute('fill'); favBtn.style.color=''; }

    const galleryIds = p.images||[];
    const galleryHtml = galleryIds.length
      ? `<div class="detail-gallery" id="detailGallery">${galleryIds.map((iid,i)=>`<div class="gallery-img" data-index="${i}" id="gimg-${iid}"></div>`).join('')}</div>`
      : '';

    const chipsHtml = `<div class="card-chips" style="margin-bottom:12px;">
      ${p.poseCategory?`<span class="chip chip-pose">${esc(p.poseCategory)}</span>`:''}
      ${p.dressCategory?`<span class="chip chip-dress">${esc(p.dressCategory)}</span>`:''}
      ${(p.tags||[]).map(t=>`<span class="tag-pill">#${esc(t)}</span>`).join('')}
    </div>`;

    const promptHtml = `<div class="detail-section">
      <div class="section-label"><i data-lucide="message-square"></i> Prompt</div>
      <div class="prompt-text-box">
        <button class="copy-btn" id="detailCopyBtn"><i data-lucide="copy"></i> Copy</button>
        ${esc(p.prompt)}
      </div></div>`;
    const negHtml = p.negativePrompt
      ? `<div class="detail-section"><div class="section-label"><i data-lucide="ban"></i> Negative Prompt</div><div class="prompt-text-box">${esc(p.negativePrompt)}</div></div>`
      : '';
    const notesHtml = p.notes
      ? `<div class="detail-section"><div class="section-label"><i data-lucide="sticky-note"></i> Notes</div><div class="prompt-text-box">${esc(p.notes)}</div></div>`
      : '';
    const metaHtml = `<div class="detail-section"><div class="section-label"><i data-lucide="info"></i> Metadata</div>
      <div class="detail-meta">
        <div class="meta-item"><div class="meta-label">Created</div><div class="meta-value">${UI.formatDate(p.createdAt)}</div></div>
        <div class="meta-item"><div class="meta-label">Updated</div><div class="meta-value">${UI.formatDate(p.updatedAt)}</div></div>
        <div class="meta-item"><div class="meta-label">Last Used</div><div class="meta-value">${UI.formatDate(p.lastUsedAt)}</div></div>
        <div class="meta-item"><div class="meta-label">Times Copied</div><div class="meta-value">${p.usageCount||0}</div></div>
      </div></div>`;

    document.getElementById('detailBody').innerHTML = galleryHtml+chipsHtml+promptHtml+negHtml+notesHtml+metaHtml;

    for (let i=0; i<galleryIds.length; i++) {
      const iid = galleryIds[i];
      const url = await Storage.getImageUrl(iid);
      const target = document.getElementById(`gimg-${iid}`);
      if (url && target) {
        target.innerHTML=`<img src="${url}" alt="ref ${i+1}" />`;
        target.addEventListener('click', ()=>openLightbox(galleryIds,i));
      }
    }

    document.getElementById('detailCopyBtn').addEventListener('click', async ()=>{
      const ok = await UI.copyToClipboard(p.prompt);
      if (ok) {
        Storage.incrementUsage(id);
        const updated = Storage.getPrompt(id);
        await HistoryManager.log(HistoryManager.ACTIONS.USED, updated);
        SyncManager.queueUpsert(updated); SyncManager.drainQueue();
        UI.toast('Prompt copied!','success');
      }
    });

    UI.openModal('detailModal');
    UI.refreshIcons();
  }

  /* ═══════════════════════════════════════════════════
     LIGHTBOX
     ═══════════════════════════════════════════════════ */
  let lightboxList=[], lightboxIndex=0;

  async function openLightbox(imageIds, startIdx) {
    lightboxList=imageIds; lightboxIndex=startIdx;
    await updateLightbox();
    document.getElementById('lightbox').classList.remove('hidden');
    UI.refreshIcons();
  }
  async function updateLightbox() {
    const id = lightboxList[lightboxIndex];
    const url = await Storage.getImageUrl(id);
    document.getElementById('lightboxImg').src = url||'';
    document.getElementById('lbCounter').textContent = `${lightboxIndex+1} / ${lightboxList.length}`;
    document.getElementById('lbPrev').style.display = lightboxList.length>1?'':'none';
    document.getElementById('lbNext').style.display = lightboxList.length>1?'':'none';
  }
  function navigateLightbox(dir) {
    if (!lightboxList.length) return;
    lightboxIndex=(lightboxIndex+dir+lightboxList.length)%lightboxList.length;
    updateLightbox();
  }

  /* ═══════════════════════════════════════════════════
     EXPORT / IMPORT
     ═══════════════════════════════════════════════════ */
  async function exportData() {
    UI.toast('Preparing export…','info',1500);
    try {
      const data = await Storage.exportData(false); // full export with images
      const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href=url; a.download=`vrshoot-backup-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      UI.toast('Backup downloaded','success');
    } catch(e) { console.error(e); UI.toast('Export failed','error'); }
  }

  async function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const ok = await UI.confirm({ title:'Import backup?', message:'This will replace all your current data. Continue?', okText:'Import', danger:false });
    if (!ok) { e.target.value=''; return; }
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      await Storage.importData(json);
      UI.toast('Backup imported successfully','success');
      refreshAll();
    } catch(err) { console.error(err); UI.toast('Import failed: invalid file','error'); }
    e.target.value='';
  }

  /* ═══════════════════════════════════════════════════
     THEME
     ═══════════════════════════════════════════════════ */
  function toggleTheme() {
    const root = document.documentElement;
    const isDark = root.getAttribute('data-theme')==='dark';
    if (isDark) root.removeAttribute('data-theme'); else root.setAttribute('data-theme','dark');
    Storage.setSettings({ theme: isDark?'light':'dark' });
    const btn = document.getElementById('btnTheme');
    const icon = btn.querySelector('[data-lucide]');
    const label = btn.querySelector('span');
    icon.setAttribute('data-lucide', !isDark?'sun':'moon');
    label.textContent = !isDark?'Light Mode':'Dark Mode';
    UI.refreshIcons();
  }

  /* ═══════════════════════════════════════════════════
     UTILITIES
     ═══════════════════════════════════════════════════ */
  function refreshAll() {
    renderSidebarCategories(); renderTagCloud(); renderBadges();
    if (state.view==='dashboard') renderDashboard();
    else if (state.view==='history') loadHistory(true);
    else if (state.view==='settings') renderSettingsView();
    else renderPrompts();
  }

  function mostCommon(arr) {
    if (!arr.length) return null;
    const m={};
    arr.forEach(v=>m[v]=(m[v]||0)+1);
    return Object.entries(m).sort((a,b)=>b[1]-a[1])[0][0];
  }

  function debounce(fn,ms) { let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args),ms); }; }
  function esc(s) { return UI.escapeHtml(s); }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
