import { getInfoAsync, readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { chatApi, adminApi } from '../api';
import { storage } from './storage';
import { API_BASE_URL } from '../constants';

const CHUNK_SIZE = 1024 * 1024; // 1MB

const listeners = new Map(); // uploadId -> Set of callbacks
const activeUploads = new Map(); // uploadId -> boolean (is uploading)
const abortControllers = new Map(); // uploadId -> AbortController
const cancelledUploads = new Set(); // uploadIds explicitly cancelled by user

export const uploadManager = {
  /**
   * Подписаться на прогресс загрузки
   */
  subscribe(uploadId, callback) {
    if (!listeners.has(uploadId)) {
      listeners.set(uploadId, new Set());
    }
    listeners.get(uploadId).add(callback);
    return () => this.unsubscribe(uploadId, callback);
  },

  unsubscribe(uploadId, callback) {
    if (listeners.has(uploadId)) {
      listeners.get(uploadId).delete(callback);
      if (listeners.get(uploadId).size === 0) {
        listeners.delete(uploadId);
      }
    }
  },

  notifyProgress(uploadId, progress, status = 'uploading', result = null, extra = {}) {
    if (listeners.has(uploadId)) {
      // Защита от NaN
      const safeProgress = isNaN(progress) ? 0 : progress;
      console.log(`[UploadManager] Notifying progress for ${uploadId}: ${safeProgress}, status: ${status}`);
      listeners.get(uploadId).forEach(cb => cb({ 
        progress: safeProgress, 
        status, 
        result,
        ...extra
      }));
    }
  },

  /**
   * Отменить загрузку
   */
  async cancelUpload(uploadId) {
    console.log(`[UploadManager] Cancelling upload ${uploadId}`);
    cancelledUploads.add(uploadId);

    // Call server API to cleanup session and placeholder message
    try {
      const token = await storage.getAccessToken();
      if (token) {
        chatApi.cancelUpload(uploadId, token).catch(() => {});
      }
    } catch (e) {}

    // Remove persisted info so it won't be resumed on chat re-entry
    storage.removeItem(`upload_info_${uploadId}`).catch(() => {});
    if (abortControllers.has(uploadId)) {
      abortControllers.get(uploadId).abort();
      abortControllers.delete(uploadId);
      activeUploads.delete(uploadId);
      this.notifyProgress(uploadId, 0, 'cancelled');
      return true;
    }
    this.notifyProgress(uploadId, 0, 'cancelled');
    return false;
  },

  /**
   * Загрузка файла (обертка над uploadFileResumable для обратной совместимости)
   */
  async uploadFile(fileUri, fileName, mimeType, onProgress) {
    let unsubscribe = null;
    try {
      const result = await this.uploadFileResumable(
        fileUri,
        fileName,
        mimeType,
        null,
        (uploadId) => {
          if (onProgress) {
            unsubscribe = this.subscribe(uploadId, ({ progress }) => {
              onProgress(progress);
            });
          }
        }
      );
      return result;
    } finally {
      if (unsubscribe) unsubscribe();
    }
  },

  /**
   * Загружает файл по частям с возможностью возобновления
   */
  async uploadFileResumable(fileUri, fileName, mimeType, receiverId, onInit, apiOptions = {}, extraMeta = {}) {
    const { 
      api = chatApi, 
      chunkPath = '/chat/upload/chunk/'
    } = apiOptions;

    const token = await storage.getAccessToken();
    const fileInfo = await getInfoAsync(fileUri);
    const fileSize = fileInfo.size;

    // 1. Инициализация загрузки
    const initRes = await api.initUpload({
      filename: fileName,
      file_size: fileSize,
      mime_type: mimeType,
      receiver_id: receiverId,
      client_id: extraMeta?.clientId,
      message_type: extraMeta?.messageType,
      duration: extraMeta?.duration
    }, token);

    const { upload_id } = initRes.data;
    
    // Вызываем колбэк сразу после получения ID
    if (onInit) onInit(upload_id);
    
    // Сохраняем метаданные загрузки для возможности восстановления
    const uploadInfo = {
      upload_id,
      fileUri,
      fileName,
      mimeType,
      fileSize,
      receiverId,
      apiOptions, // Сохраняем настройки API для возобновления
      startTime: Date.now(),
      ...extraMeta // Сохраняем clientId, messageType и т.д.
    };
    await storage.saveItem(`upload_info_${upload_id}`, JSON.stringify(uploadInfo));
    
    const result = await this.runUploadLoop(upload_id, fileUri, 0, fileSize, token, chunkPath, extraMeta);
    return { ...result, upload_id, ...extraMeta };
  },

  async runUploadLoop(uploadId, fileUri, startOffset, fileSize, token, chunkPath = '/chat/upload/chunk/', extraMeta = {}) {
    if (activeUploads.get(uploadId)) {
      console.log(`[UploadManager] Upload ${uploadId} is already running`);
      return;
    }
    activeUploads.set(uploadId, true);
    const controller = new AbortController();
    abortControllers.set(uploadId, controller);
    
    console.log(`[UploadManager] Starting upload loop for ${uploadId} from offset ${startOffset}`);

    let currentOffset = Number(startOffset) || 0;
    const totalSize = Number(fileSize);

    // Notify immediately so UI shows the upload indicator before the first chunk is sent
    this.notifyProgress(uploadId, currentOffset / totalSize, 'uploading', null, {
      loaded: currentOffset,
      total: totalSize,
      ...extraMeta
    });

    try {
      while (currentOffset < totalSize) {
        // Проверяем не отменена ли загрузка
        if (controller.signal.aborted) {
          throw new Error('Upload cancelled');
        }

        const length = Math.min(CHUNK_SIZE, totalSize - currentOffset);
        const chunkResult = await this.uploadChunk(uploadId, fileUri, currentOffset, length, token, controller.signal, chunkPath);
      
        if (chunkResult.status === 'completed') {
          activeUploads.delete(uploadId);
          abortControllers.delete(uploadId);
          await storage.removeItem(`upload_info_${uploadId}`);
          this.notifyProgress(uploadId, 1, 'completed', chunkResult, { 
            loaded: totalSize, 
            total: totalSize,
            ...extraMeta
          });
          return { ...chunkResult, ...extraMeta };
        }
        
        currentOffset = Number(chunkResult.offset);
        if (isNaN(currentOffset)) {
          throw new Error('Server returned invalid offset (NaN)');
        }

        this.notifyProgress(uploadId, currentOffset / totalSize, 'uploading', null, {
          loaded: currentOffset,
          total: totalSize,
          ...extraMeta
        });
      }
    } catch (error) {
      activeUploads.delete(uploadId);
      abortControllers.delete(uploadId);
      if (error.name === 'AbortError' || controller.signal.aborted || error.message === 'Upload cancelled') {
        console.log(`[UploadManager] Upload ${uploadId} caught cancellation`);
        this.notifyProgress(uploadId, 0, 'cancelled');
      } else {
        this.notifyProgress(uploadId, currentOffset / totalSize, 'error');
        throw error;
      }
    } finally {
      activeUploads.delete(uploadId);
      abortControllers.delete(uploadId);
    }
  },

  async uploadChunk(uploadId, fileUri, offset, length, token, signal, chunkPath = '/chat/upload/chunk/') {
    // Pass token and offset as query params for better reliability
    const uploadUrl = `${API_BASE_URL}${chunkPath}${uploadId}?q_token=${encodeURIComponent(token)}&q_offset=${offset}`;
    
    try {
      const fileData = await readAsStringAsync(fileUri, {
        encoding: EncodingType.Base64,
        position: offset,
        length: length,
      });

      const formData = new FormData();
      const chunkUri = `data:application/octet-stream;base64,${fileData}`;
      formData.append('chunk', {
        uri: chunkUri,
        name: 'chunk',
        type: 'application/octet-stream',
      });
      
      formData.append('offset', offset.toString());

      const headers = {
        'Accept': 'application/json',
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
        headers: headers,
        signal: signal
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`Chunk upload failed with status ${res.status}: ${errorText}`);
        throw new Error(`Upload failed: ${res.status}`);
      }

      return await res.json();
    } catch (error) {
      // AbortError is an expected outcome when user cancels upload (AbortController.abort()).
      // Do not log it as an error to avoid confusing diagnostics.
      const aborted = signal?.aborted || error?.name === 'AbortError';
      if (aborted) {
        console.log(`[UploadManager] uploadChunk aborted for ${uploadId} at offset ${offset}`);
      } else {
        console.error('Error in uploadChunk:', error);
      }
      throw error;
    }
  },

  /**
   * Проверяет статус существующей загрузки и продолжает её
   */
  async resumeUpload(uploadId, fileUri, fileName, receiverId, apiOptions = {}, extraMeta = {}) {
    const { 
      api = chatApi, 
      chunkPath = '/chat/upload/chunk/'
    } = apiOptions;

    const token = await storage.getAccessToken();
    const statusRes = await api.getUploadStatus(uploadId, token);
    const { offset, is_completed } = statusRes.data;

    if (is_completed) {
      await storage.removeItem(`upload_info_${uploadId}`);
      return { status: 'completed', ...extraMeta };
    }

    const fileInfo = await getInfoAsync(fileUri);
    const fileSize = fileInfo.size;
    
    return this.runUploadLoop(uploadId, fileUri, offset, fileSize, token, chunkPath, extraMeta);
  },

  /**
   * Находит и восстанавливает активные загрузки для конкретного получателя
   */
  async getActiveUploadsForReceiver(receiverId) {
    const token = await storage.getAccessToken();
    try {
      const res = await chatApi.getActiveUploads(token);
      const serverActiveUploads = res.data;
      
      const recovered = [];
      for (const serverUpload of serverActiveUploads) {
        // Проверяем, есть ли у нас локальная информация об этой загрузке
        // Skip uploads explicitly cancelled by the user in this session
        if (cancelledUploads.has(serverUpload.upload_id)) continue;

        const localInfoStr = await storage.getItem(`upload_info_${serverUpload.upload_id}`);
        if (localInfoStr) {
          const localInfo = JSON.parse(localInfoStr);
          if (localInfo.receiverId === receiverId) {
            recovered.push({
              ...localInfo,
              currentOffset: serverUpload.offset
            });
            
            // Если она еще не запущена локально - запускаем
            if (!activeUploads.get(serverUpload.upload_id)) {
              // Extract extra meta for resume
              const { upload_id, fileUri, fileName, receiverId: rId, apiOptions, startTime, ...meta } = localInfo;
              this.resumeUpload(
                serverUpload.upload_id, 
                localInfo.fileUri, 
                localInfo.fileName, 
                localInfo.receiverId,
                localInfo.apiOptions || {},
                meta
              ).catch(err => console.error(`Failed to resume upload ${serverUpload.upload_id}:`, err));
            }
          }
        }
      }
      return recovered;
    } catch (error) {
      console.error('Error fetching active uploads:', error);
      return [];
    }
  }
};
