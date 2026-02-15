import * as FileSystem from 'expo-file-system/legacy';
import { chatApi } from '../api';
import { storage } from './storage';
import { API_BASE_URL } from '../constants';

const CHUNK_SIZE = 1024 * 1024; // 1MB

export const uploadManager = {
  /**
   * Загружает файл по частям с возможностью возобновления
   */
  async uploadFileResumable(fileUri, fileName, mimeType, onProgress) {
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
    let currentOffset = 0;

    // Сохраняем ID загрузки, чтобы можно было возобновить позже (упрощенно)
    await storage.saveItem(`upload_${fileName}_${fileSize}`, upload_id);

    // 2. Цикл загрузки чанков
    while (currentOffset < fileSize) {
      const length = Math.min(CHUNK_SIZE, fileSize - currentOffset);
      
      // Читаем часть файла (базовое решение через FileSystem.uploadAsync)
      // В идеале Expo FileSystem.readAsStringAsync с опциями length/position,
      // но для простоты и надежности фоновой работы воспользуемся их стандартным механизмом если возможно,
      // или будем резать файл на части (что накладно).
      
      // Для настоящей фоновой загрузки больших файлов лучше использовать TaskManager,
      // но здесь мы реализуем надежный цикл с докачкой.

      const chunkResult = await this.uploadChunk(upload_id, fileUri, currentOffset, length, token);
      
      if (chunkResult.status === 'completed') {
        return chunkResult;
      }
      
      currentOffset = chunkResult.offset;
      if (onProgress) {
        onProgress(currentOffset / fileSize);
      }
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
  async resumeUpload(uploadId, fileUri, fileName, onProgress) {
    const token = await storage.getAccessToken();
    const statusRes = await chatApi.getUploadStatus(uploadId, token);
    const { offset, is_completed } = statusRes.data;

    if (is_completed) return { status: 'completed' };

    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    const fileSize = fileInfo.size;
    
    let currentOffset = offset;
    while (currentOffset < fileSize) {
      const length = Math.min(CHUNK_SIZE, fileSize - currentOffset);
      const chunkResult = await this.uploadChunk(uploadId, fileUri, currentOffset, length, token);
      
      if (chunkResult.status === 'completed') return chunkResult;
      
      currentOffset = chunkResult.offset;
      if (onProgress) onProgress(currentOffset / fileSize);
    }
  }
};
