/* =====================================================
   storage.js — Data persistence layer
   - Prompts metadata + categories + tags  -> LocalStorage
   - Image blobs                            -> IndexedDB
   ===================================================== */

const Storage = (() => {
  const LS_PROMPTS   = 'vrshoot.prompts.v1';
  const LS_POSES     = 'vrshoot.poses.v1';
  const LS_DRESSES   = 'vrshoot.dresses.v1';
  const LS_TAGS      = 'vrshoot.tags.v1';
  const LS_SETTINGS  = 'vrshoot.settings.v1';

  const DEFAULT_POSES = [
    'Front Pose','Back Pose','Side Pose','Closeup Shot',
    'Detail Shot','Wide Angle Shot','Full Body','Three Quarter','Portrait'
  ];
  const DEFAULT_DRESSES = [
    '2 Piece','3 Piece','Banarsi','Saree','Lehenga',
    'Gown','Casual Wear','Formal Wear','Bridal'
  ];

  /* ---------- LocalStorage helpers ---------- */
  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('LS get failed', key, e);
      return fallback;
    }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.error('LS set failed', key, e); }
  }

  /* ---------- IndexedDB for images ---------- */
  const DB_NAME = 'vrshoot-db';
  const DB_VERSION = 1;
  const STORE_IMAGES = 'images';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode = 'readonly') {
    const db = await openDB();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  async function saveImage(id, blob) {
    const store = await tx(STORE_IMAGES, 'readwrite');
    return new Promise((resolve, reject) => {
      const r = store.put({ id, blob, createdAt: Date.now() });
      r.onsuccess = () => resolve(id);
      r.onerror = () => reject(r.error);
    });
  }

  async function getImage(id) {
    const store = await tx(STORE_IMAGES);
    return new Promise((resolve, reject) => {
      const r = store.get(id);
      r.onsuccess = () => resolve(r.result ? r.result.blob : null);
      r.onerror = () => reject(r.error);
    });
  }

  async function deleteImage(id) {
    const store = await tx(STORE_IMAGES, 'readwrite');
    return new Promise((resolve) => {
      const r = store.delete(id);
      r.onsuccess = () => resolve(true);
      r.onerror  = () => resolve(false);
    });
  }

  async function getImageUrl(id) {
    const blob = await getImage(id);
    if (!blob) return null;
    return URL.createObjectURL(blob);
  }

  async function getAllImages() {
    const store = await tx(STORE_IMAGES);
    return new Promise((resolve) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror   = () => resolve([]);
    });
  }

  /* ---------- Image compression (Canvas API) ---------- */
  function compressImage(file, maxDim = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => {
        img.onload = () => {
          let { width, height } = img;
          const ratio = Math.min(maxDim / width, maxDim / height, 1);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          // Prefer webp if supported
          const type = 'image/webp';
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else canvas.toBlob((b2) => resolve(b2), 'image/jpeg', quality);
          }, type, quality);
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* ---------- ID generator ---------- */
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10);
  }

  /* ---------- Prompts CRUD ---------- */
  function getPrompts()        { return lsGet(LS_PROMPTS, []); }
  function setPrompts(arr)     { lsSet(LS_PROMPTS, arr); }
  function getPrompt(id)       { return getPrompts().find(p => p.id === id) || null; }

  function addPrompt(data) {
    const prompts = getPrompts();
    const now = new Date().toISOString();
    const item = {
      id: uuid(),
      title: data.title || 'Untitled',
      prompt: data.prompt || '',
      negativePrompt: data.negativePrompt || '',
      images: data.images || [],
      poseCategory: data.poseCategory || '',
      dressCategory: data.dressCategory || '',
      tags: data.tags || [],
      notes: data.notes || '',
      isFavorite: !!data.isFavorite,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null
    };
    prompts.unshift(item);
    setPrompts(prompts);
    // Update tag pool
    if (item.tags.length) {
      const pool = new Set(getTags());
      item.tags.forEach(t => pool.add(t));
      setTags([...pool]);
    }
    return item;
  }

  function updatePrompt(id, patch) {
    const prompts = getPrompts();
    const idx = prompts.findIndex(p => p.id === id);
    if (idx === -1) return null;
    prompts[idx] = { ...prompts[idx], ...patch, updatedAt: new Date().toISOString() };
    setPrompts(prompts);
    if (patch.tags) {
      const pool = new Set(getTags());
      patch.tags.forEach(t => pool.add(t));
      setTags([...pool]);
    }
    return prompts[idx];
  }

  async function deletePrompt(id) {
    const prompts = getPrompts();
    const target = prompts.find(p => p.id === id);
    if (!target) return false;
    // Delete associated images
    if (target.images && target.images.length) {
      await Promise.all(target.images.map(imgId => deleteImage(imgId)));
    }
    setPrompts(prompts.filter(p => p.id !== id));
    return true;
  }

  function incrementUsage(id) {
    const prompts = getPrompts();
    const idx = prompts.findIndex(p => p.id === id);
    if (idx === -1) return;
    prompts[idx].usageCount = (prompts[idx].usageCount || 0) + 1;
    prompts[idx].lastUsedAt = new Date().toISOString();
    setPrompts(prompts);
  }

  function toggleFavorite(id) {
    const p = getPrompt(id);
    if (!p) return null;
    return updatePrompt(id, { isFavorite: !p.isFavorite });
  }

  /* ---------- Categories & Tags ---------- */
  function getPoses() {
    const arr = lsGet(LS_POSES, null);
    if (!arr) { lsSet(LS_POSES, DEFAULT_POSES); return [...DEFAULT_POSES]; }
    return arr;
  }
  function setPoses(arr) { lsSet(LS_POSES, arr); }
  function addPose(name) {
    name = (name || '').trim();
    if (!name) return false;
    const arr = getPoses();
    if (arr.includes(name)) return false;
    arr.push(name); setPoses(arr); return true;
  }

  function getDresses() {
    const arr = lsGet(LS_DRESSES, null);
    if (!arr) { lsSet(LS_DRESSES, DEFAULT_DRESSES); return [...DEFAULT_DRESSES]; }
    return arr;
  }
  function setDresses(arr) { lsSet(LS_DRESSES, arr); }
  function addDress(name) {
    name = (name || '').trim();
    if (!name) return false;
    const arr = getDresses();
    if (arr.includes(name)) return false;
    arr.push(name); setDresses(arr); return true;
  }

  function getTags() { return lsGet(LS_TAGS, []); }
  function setTags(arr) { lsSet(LS_TAGS, arr); }

  /* ---------- Settings ---------- */
  function getSettings() {
    return lsGet(LS_SETTINGS, { theme: 'light', layout: 'grid' });
  }
  function setSettings(patch) {
    const s = { ...getSettings(), ...patch };
    lsSet(LS_SETTINGS, s);
    return s;
  }

  /* ---------- Export / Import ---------- */
  // metaOnly = true skips image blob encoding (used by cloud backup)
  async function exportData(metaOnly = false) {
    const prompts = getPrompts();
    let imagesSerialized = [];
    if (!metaOnly) {
      const images = await getAllImages();
      imagesSerialized = await Promise.all(images.map(async img => ({
        id: img.id,
        createdAt: img.createdAt,
        base64: await blobToBase64(img.blob),
        mime: img.blob.type
      })));
    }
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      prompts,
      poses: getPoses(),
      dresses: getDresses(),
      tags: getTags(),
      images: imagesSerialized
    };
  }

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });
  }

  async function importData(json) {
    if (!json || !Array.isArray(json.prompts)) throw new Error('Invalid backup format');
    setPrompts(json.prompts);
    if (Array.isArray(json.poses))   setPoses(json.poses);
    if (Array.isArray(json.dresses)) setDresses(json.dresses);
    if (Array.isArray(json.tags))    setTags(json.tags);
    if (Array.isArray(json.images)) {
      for (const img of json.images) {
        const blob = base64ToBlob(img.base64, img.mime || 'image/webp');
        await saveImage(img.id, blob);
      }
    }
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const len = bin.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* ---------- Public API ---------- */
  return {
    // prompts
    getPrompts, setPrompts, getPrompt, addPrompt, updatePrompt, deletePrompt,
    incrementUsage, toggleFavorite,
    // categories
    getPoses, addPose, setPoses,
    getDresses, addDress, setDresses,
    getTags, setTags,
    // images
    saveImage, getImage, getImageUrl, deleteImage, getAllImages, compressImage,
    // utils
    uuid, blobToBase64, base64ToBlob,
    // settings
    getSettings, setSettings,
    // backup
    exportData, importData
  };
})();
