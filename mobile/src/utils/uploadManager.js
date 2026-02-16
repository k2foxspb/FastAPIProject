import * as FileSystem from 'expo-file-system/legacy';
import { chatApi } from '../api';
import { storage } from './storage';
import { API_BASE_URL } from '../constants';

const CHUNK_SIZE = 1024 * 1024; // 1MB

const listeners = new Map(); // uploadId -> Set of callbacks
const activeUploads = new Map(); // uploadId -> boolean (is uploading)

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

  notifyProgress(uploadId, progress, status = 'uploading', result = null) {
    if (listeners.has(uploadId)) {
      listeners.get(uploadId).forEach(cb => cb({ progress, status, result }));
    }
  },

  /**
   * Загружает файл по частям с возможностью возобновления
   */
  async uploadFileResumable(fileUri, fileName, mimeType, receiverId) {
    const token = await storage.getAccessToken();
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    const fileSize = fileInfo.size;

    // 1. Инициализация загрузки
    const initRes = await chatApi.initUpload({
      filename: fileName,
      file_size: fileSize,
      mime_type: mimeType
    }, token);

    const { upload_id } = initRes.data;
    
    // Сохраняем метаданные загрузки для возможности восстановления
    const uploadInfo = {
      upload_id,
      fileUri,
      fileName,
      mimeType,
      fileSize,
      receiverId,
      startTime: Date.now()
    };
    await storage.saveItem(`upload_info_${upload_id}`, JSON.stringify(uploadInfo));
    
    const result = await this.runUploadLoop(upload_id, fileUri, 0, fileSize, token);
    return { ...result, upload_id };
  },

  async runUploadLoop(uploadId, fileUri, startOffset, fileSize, token) {
    if (activeUploads.get(uploadId)) return; // Уже загружается
    activeUploads.set(uploadId, true);

    let currentOffset = startOffset;
    try {
      while (currentOffset < fileSize) {
        const length = Math.min(CHUNK_SIZE, fileSize - currentOffset);
        const chunkResult = await this.uploadChunk(uploadId, fileUri, currentOffset, length, token);
        
        if (chunkResult.status === 'completed') {
          activeUploads.delete(uploadId);
          await storage.removeItem(`upload_info_${uploadId}`);
          this.notifyProgress(uploadId, 1, 'completed', chunkResult);
          return chunkResult;
        }
        
        currentOffset = chunkResult.offset;
        this.notifyProgress(uploadId, currentOffset / fileSize);
      }
    } catch (error) {
      activeUploads.delete(uploadId);
      this.notifyProgress(uploadId, currentOffset / fileSize, 'error');
      throw error;
    } finally {
      activeUploads.delete(uploadId);
    }
  },

  async uploadChunk(uploadId, fileUri, offset, length, token) {
    // Pass token and offset as query params for better reliability
    const uploadUrl = `${API_BASE_URL}/chat/upload/chunk/${uploadId}?q_token=${encodeURIComponent(token)}&q_offset=${offset}`;
    
    try {
      // For reliable chunking in React Native, we can read the file as base64 
      // and convert it back to a Blob, or use a polyfill.
      // But a more robust way for RN is to use a specific slice of the file.
      // Fetching the whole file into a blob and then slicing is memory intensive for large files.
      
      const fileData = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
        position: offset,
        length: length,
      });

      const formData = new FormData();
      // We send the base64 string. The backend will need to decode it if we send it as a field,
      // or we can convert it to a "file" object that RN's FormData accepts.
      
      // In RN, you can append an object with uri, name, type to FormData.
      // But since we have the actual data as base64, let's use a trick:
      // Create a data URI and use that as the URI for the form data object.
      const chunkUri = `data:application/octet-stream;base64,${fileData}`;

      formData.append('chunk', {
        uri: chunkUri,
        name: 'chunk',
        type: 'application/octet-stream',
      });
      
      formData.append('offset', offset.toString());

      const res = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
        }
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`Chunk upload failed with status ${res.status}: ${errorText}`);
        throw new Error(`Upload failed: ${res.status}`);
      }

      return await res.json();
    } catch (error) {
      console.error('Error in uploadChunk:', error);
      throw error;
    }
  },

  /**
   * Проверяет статус существующей загрузки и продолжает её
   */
  async resumeUpload(uploadId, fileUri, fileName, receiverId) {
    const token = await storage.getAccessToken();
    const statusRes = await chatApi.getUploadStatus(uploadId, token);
    const { offset, is_completed } = statusRes.data;

    if (is_completed) {
      await storage.removeItem(`upload_info_${uploadId}`);
      return { status: 'completed' };
    }

    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    const fileSize = fileInfo.size;
    
    return this.runUploadLoop(uploadId, fileUri, offset, fileSize, token);
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
              this.resumeUpload(
                serverUpload.upload_id, 
                localInfo.fileUri, 
                localInfo.fileName, 
                localInfo.receiverId
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
