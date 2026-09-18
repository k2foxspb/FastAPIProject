import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { uploadManager } from '../../../utils/uploadManager';
import { generateClientId, getMediaTypeFromMime, emptyUploadingData, buildOptimisticMessage } from '../utils';

// Загрузка файлов/медиа/голосовых/видеосообщений в чат через uploadManager
export default function useChatUploads({
  userId,
  currentUserId,
  sendMessageWs,
  isChatConnected,
  setMessages,
  replyingToMessage,
  setReplyingToMessage,
  isMounted,
}) {
  const [uploadingProgress, setUploadingProgress] = useState(null);
  const [uploadingData, setUploadingData] = useState(emptyUploadingData());
  const [activeUploadId, setActiveUploadId] = useState(null);
  // Групповая отправка медиа
  const [batchMode, setBatchMode] = useState(false);
  const [batchTotal, setBatchTotal] = useState(0);
  const [autoSendOnUpload, setAutoSendOnUpload] = useState(true);
  const [attachmentsLocalCount, setAttachmentsLocalCount] = useState(0);
  const isVideoNoteUploadRef = useRef(false);

  const resetUploadState = () => {
    setUploadingProgress(null);
    setActiveUploadId(null);
    setUploadingData(emptyUploadingData());
  };

  const handleCancelUpload = useCallback((uploadId) => {
    if (!uploadId) return;
    console.log('[ChatScreen] Cancelling upload:', uploadId);
    uploadManager.cancelUpload(uploadId);
    if (isChatConnected) {
      sendMessageWs({ type: 'upload_cancelled', upload_id: uploadId });
    }
    setUploadingProgress(null);
    setActiveUploadId(null);
    setUploadingData(emptyUploadingData());
  }, [isChatConnected, sendMessageWs]);

  // Проверка активных загрузок (например, после перезахода в чат)
  const restoreActiveUploads = useCallback((receiverId) => {
    uploadManager.getActiveUploadsForReceiver(receiverId).then(activeUploads => {
      if (activeUploads.length > 0) {
        const mainUpload = activeUploads[0];
        setActiveUploadId(mainUpload.upload_id);
        setUploadingProgress(mainUpload.currentOffset / mainUpload.fileSize);
        setUploadingData({ 
          loaded: mainUpload.currentOffset, 
          total: mainUpload.fileSize,
          uri: mainUpload.fileUri,
          mimeType: mainUpload.mimeType,
          ...mainUpload
        });
        
        // Добавляем подписку, чтобы вовремя убрать плейсхолдер
        uploadManager.subscribe(mainUpload.upload_id, (progressData) => {
          if (progressData.status === 'completed' || progressData.status === 'error' || progressData.status === 'cancelled') {
            setActiveUploadId(null);
            setUploadingProgress(null);
            setUploadingData(emptyUploadingData());
          } else if (progressData.status === 'uploading') {
            setUploadingProgress(progressData.progress);
            if (progressData.loaded !== undefined) {
              setUploadingData(prev => ({ 
                ...prev, 
                loaded: progressData.loaded, 
                total: progressData.total 
              }));
            }
          }
        });
      }
    }).catch(err => console.log('[ChatScreen] Failed to check active uploads', err));
  }, []);

  useEffect(() => {
    if (activeUploadId) {
      const unsubscribe = uploadManager.subscribe(activeUploadId, ({ progress, status, result, loaded, total, ...extra }) => {
        setUploadingProgress(progress);
        if (loaded !== undefined) setUploadingData(prev => ({ ...prev, loaded, total, ...extra }));
        
        if (status === 'completed') {
          // Fallback: Обновляем сообщение в локальном стейте, если WS еще не прислал обновление
          if (result && result.file_path) {
            setMessages(prev => {
              const uploadIdMatch = prev.findIndex(m => m.upload_id === activeUploadId);
              const clientIdMatch = extra?.clientId ? prev.findIndex(m => m.client_id === extra.clientId) : -1;
              const idx = uploadIdMatch !== -1 ? uploadIdMatch : clientIdMatch;
              
              if (idx !== -1) {
                const newMsgs = [...prev];
                newMsgs[idx] = { 
                  ...newMsgs[idx], 
                  ...result, 
                  is_uploading: false, 
                  upload_progress: undefined 
                };
                return newMsgs;
              }
              return prev;
            });
          }

          // Для одиночных голосовых сообщений отправляем здесь
          // Для медиа и документов теперь отправляем вручную в функциях загрузки
          // Если есть hasPlaceholder, значит бэкенд сам обновит сообщение
          if (autoSendOnUpload && !batchMode && !isVideoNoteUploadRef.current && !extra?.hasPlaceholder) { 
            const clientId = extra?.clientId || generateClientId();
            const msgData = {
              receiver_id: userId,
              file_path: result.file_path,
              message_type: result.message_type,
              client_id: clientId,
              reply_to_id: replyingToMessage ? replyingToMessage.id : null
            };
            
            // Оптимистичное добавление
            setMessages(prev => [buildOptimisticMessage(msgData, currentUserId, replyingToMessage), ...prev]);
            setReplyingToMessage(null);

            sendMessageWs(msgData);
          } 
          resetUploadState();
        } else if (status === 'error') {
          resetUploadState();
          Alert.alert('Ошибка', 'Не удалось завершить загрузку файла');
        } else if (status === 'cancelled') {
          resetUploadState();
        }
      });
      return () => unsubscribe();
    }
  }, [activeUploadId, userId, autoSendOnUpload, replyingToMessage]);

  const beginBatch = (count) => {
    setBatchMode(true);
    setAutoSendOnUpload(false);
    setBatchTotal(count);
    setAttachmentsLocalCount(0);
  };

  const endBatch = () => {
    setTimeout(() => {
      if (!isMounted.current) return;
      setBatchMode(false);
      setAutoSendOnUpload(true);
      setBatchTotal(0);
      setAttachmentsLocalCount(0);
      setUploadingProgress(null);
      setActiveUploadId(null);
    }, 100);
  };

  const uploadBatchAsset = async ({ uri, name, mimeType, size }, clientId, attachmentsLocal, errorLabel) => {
    const mt = getMediaTypeFromMime(mimeType);
    setUploadingData({ 
      loaded: 0, 
      total: size || 0, 
      uri, 
      mimeType,
      type: mt
    });
    setUploadingProgress(0);
    
    try {
      const res = await uploadManager.uploadFileResumable(
        uri,
        name,
        mimeType,
        userId,
        (uid) => { 
          setActiveUploadId(uid);
        },
        {}, // apiOptions
        { clientId, hasPlaceholder: true, type: mt, messageType: mt }
      );

      if (res && res.status === 'completed') {
        setAttachmentsLocalCount(prev => prev + 1);
        attachmentsLocal.push({ file_path: res.file_path, type: res.message_type });
      }
    } catch (err) {
      console.error(errorLabel, name, err);
    }
  };

  // Отправка финального сообщения после загрузки всех вложений
  const finalizeBatch = (attachmentsLocal, clientId) => {
    if (attachmentsLocal.length === 0) return;

    const isSingle = attachmentsLocal.length === 1;
    const msgData = isSingle 
      ? {
          receiver_id: userId,
          file_path: attachmentsLocal[0].file_path,
          message_type: attachmentsLocal[0].type,
          client_id: clientId
        }
      : {
          receiver_id: userId,
          attachments: attachmentsLocal,
          message_type: 'media_group',
          client_id: clientId
        };

    // Для media_group нужно добавить оптимистичное сообщение и отправить финальное уведомление
    if (!isSingle) {
      setMessages(prev => [buildOptimisticMessage(msgData, currentUserId), ...prev]);
      sendMessageWs(msgData);
    }
    // Для одиночного медиа-файла бэкенд уже создал плейсхолдер и завершил сообщение сам.
  };

  const pickAndUploadDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true
      });

      if (!result.canceled) {
        const assets = result.assets || [];
        beginBatch(assets.length);
        const attachmentsLocal = [];
        const clientId = generateClientId();
        
        for (const asset of assets) {
          await uploadBatchAsset(
            { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size },
            clientId,
            attachmentsLocal,
            'Failed to upload asset in batch'
          );
        }

        finalizeBatch(attachmentsLocal, clientId);
      }
    } catch (error) {
      console.error('Document picking failed', error);
      Alert.alert('Ошибка', 'Произошла ошибка при выборе или загрузке документа');
    } finally {
      endBatch();
    }
  };

  const pickAndUploadFile = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Доступ запрещен', 'Нам нужно разрешение на доступ к галерее, чтобы это работало');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
        allowsMultipleSelection: true,
      });

      if (!result.canceled) {
        let assets = result.assets || [];
        if (assets.length > 10) {
          Alert.alert('Ограничение', 'Можно отправить не более 10 файлов за раз. Лишние будут проигнорированы.');
          assets = assets.slice(0, 10);
        }

        beginBatch(assets.length);
        const attachmentsLocal = [];
        const clientId = generateClientId();

        for (const asset of assets) {
          const fileName = asset.uri.split('/').pop();
          await uploadBatchAsset(
            { uri: asset.uri, name: fileName, mimeType: asset.mimeType, size: asset.fileSize || asset.size },
            clientId,
            attachmentsLocal,
            'Failed to upload image/video in batch'
          );
        }

        finalizeBatch(attachmentsLocal, clientId);
      }
    } catch (error) {
      console.error('Upload or picking failed', error);
      Alert.alert('Ошибка', 'Произошла ошибка при выборе или загрузке файла');
    } finally {
      endBatch();
    }
  };

  const handleSendVideoNote = async (uri, durationMs = 0) => {
    if (!uri) return;
    isVideoNoteUploadRef.current = true;
    try {
      const filename = `video_note_${Date.now()}.mp4`;
      const duration = durationMs ? Math.round(durationMs / 1000) : 0;

      // Устанавливаем данные для плейсхолдера
      setUploadingData({
        uri: uri,
        mimeType: 'video/mp4',
        type: 'video_note',
        loaded: 0,
        total: 100,
        duration: duration
      });
      setUploadingProgress(0);

      const clientId = generateClientId();

      await uploadManager.uploadFileResumable(
        uri,
        filename,
        'video/mp4',
        userId,
        (id) => {
          setActiveUploadId(id);
        },
        {}, // apiOptions
        { clientId, hasPlaceholder: true, isVideoNote: true, type: 'video_note', messageType: 'video_note', duration }
      );
    } catch (err) {
      console.error('[ChatScreen] handleSendVideoNote error:', err);
      Alert.alert('Ошибка', 'Не удалось отправить видеосообщение');
    } finally {
      setTimeout(() => {
        if (!isMounted.current) return;
        isVideoNoteUploadRef.current = false;
        setUploadingProgress(null);
        setActiveUploadId(null);
      }, 100);
    }
  };

  // Возвращает true, если загрузка запущена без ошибок
  const uploadVoiceMessage = async (uri, recordingDurationMs) => {
    if (!uri) return false;
    try {
      const fileName = `voice_${Date.now()}.m4a`;
      const mimeType = 'audio/m4a';
      const duration = Math.round(recordingDurationMs / 1000);
      setUploadingData({ loaded: 0, total: 0, uri: uri, mimeType: mimeType, type: 'voice', duration });
      setUploadingProgress(0);

      const clientId = generateClientId();

      await uploadManager.uploadFileResumable(
        uri,
        fileName,
        mimeType,
        userId,
        (upload_id) => {
          setActiveUploadId(upload_id);
        },
        {}, // apiOptions
        { clientId, hasPlaceholder: true, type: 'voice', messageType: 'voice', duration }
      );
      return true;
    } catch (error) {
      console.error('Voice upload failed', error);
      Alert.alert('Ошибка', 'Не удалось загрузить голосовое сообщение');
      return false;
    } finally {
      setTimeout(() => {
        if (!isMounted.current) return;
        setUploadingProgress(null);
      }, 1000);
    }
  };

  return {
    uploadingProgress,
    uploadingData,
    activeUploadId,
    batchMode,
    batchTotal,
    attachmentsLocalCount,
    handleCancelUpload,
    restoreActiveUploads,
    pickAndUploadDocument,
    pickAndUploadFile,
    handleSendVideoNote,
    uploadVoiceMessage,
  };
}
