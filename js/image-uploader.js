/* =====================================================
   image-uploader.js — Upload images to Supabase Storage
   Falls back gracefully if offline / Supabase unavailable.
   ===================================================== */

const ImageUploader = (() => {

  /**
   * Upload a compressed Blob to Supabase Storage.
   * Returns { url, path } or null if failed.
   */
  async function uploadBlob(blob, promptId) {
    if (!SupabaseClient.isReady() || !AppConfig.ENABLE_CLOUD_SYNC) return null;

    const db = SupabaseClient.get();
    const uid = SupabaseClient.getUserId();
    const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
    const path = `${uid}/${promptId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;

    try {
      const { data, error } = await db.storage
        .from(AppConfig.STORAGE_BUCKET)
        .upload(path, blob, { contentType: blob.type, upsert: false });

      if (error) {
        console.warn('[ImageUploader] Upload error:', error.message);
        return null;
      }

      const { data: urlData } = db.storage
        .from(AppConfig.STORAGE_BUCKET)
        .getPublicUrl(data.path);

      return { url: urlData.publicUrl, path: data.path };
    } catch (err) {
      console.warn('[ImageUploader] Exception:', err);
      return null;
    }
  }

  /**
   * Delete an image from Supabase Storage by its path.
   */
  async function deleteByPath(storagePath) {
    if (!SupabaseClient.isReady() || !storagePath) return false;
    try {
      const { error } = await SupabaseClient.get().storage
        .from(AppConfig.STORAGE_BUCKET)
        .remove([storagePath]);
      if (error) console.warn('[ImageUploader] Delete error:', error.message);
      return !error;
    } catch (err) {
      console.warn('[ImageUploader] Delete exception:', err);
      return false;
    }
  }

  /**
   * Register an image record in the prompt_images table.
   */
  async function saveImageRecord(promptId, imageUrl, storagePath, order = 0) {
    if (!SupabaseClient.isReady()) return null;
    try {
      const { data, error } = await SupabaseClient.get()
        .from('prompt_images')
        .insert({ prompt_id: promptId, image_url: imageUrl, storage_path: storagePath, image_order: order })
        .select()
        .single();
      if (error) console.warn('[ImageUploader] Record error:', error.message);
      return data || null;
    } catch (err) {
      console.warn('[ImageUploader] Record exception:', err);
      return null;
    }
  }

  /**
   * Delete all image records for a prompt from prompt_images table.
   */
  async function deleteRecordsByPrompt(promptId) {
    if (!SupabaseClient.isReady()) return;
    try {
      await SupabaseClient.get().from('prompt_images').delete().eq('prompt_id', promptId);
    } catch (err) {
      console.warn('[ImageUploader] deleteRecords exception:', err);
    }
  }

  /**
   * Fetch image records for a prompt from the cloud.
   */
  async function getImageRecords(promptId) {
    if (!SupabaseClient.isReady()) return [];
    try {
      const { data, error } = await SupabaseClient.get()
        .from('prompt_images')
        .select('*')
        .eq('prompt_id', promptId)
        .order('image_order');
      if (error) return [];
      return data || [];
    } catch {
      return [];
    }
  }

  return { uploadBlob, deleteByPath, saveImageRecord, deleteRecordsByPrompt, getImageRecords };
})();
