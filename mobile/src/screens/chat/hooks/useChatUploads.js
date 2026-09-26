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
  // Групповой режим: вместо receiver_id шлём group_id через sendGroupMessageWs
  groupId = null,
  sendGroupMessageWs = null,
}) {
  const isGroupChat = !!groupId;
  const sendChatMessage = isGroupChat ? sendGroupMessageWs : sendMessageWs;
  const buildTargetFields = () => (
    isGroupChat ? { group_id: groupId } : { receiver_id: userId }
  );
  // Для группы не создаём personal placeholder на бэке — загружаем файл без receiver_id
  const uploadReceiverId = isGroupChat ? null : userId;
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
    if (isChatConnected && !isGroupChat && sendMessageWs) {
      sendMessageWs({ type: 'upload_cancelled', upload_id: uploadId });
    }
    setUploadingProgress(null);
    setActiveUploadId(null);
    setUploadingData(emptyUploadingData());
  }, [isChatConnected, sendMessageWs, isGroupChat]);

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

          // Для одиночных голосовых/медиа: в личном чате hasPlaceholder значит бэкенд сам обновит;
          // в группе placeholder'а нет — всегда отправляем group_message после аплоада.
          const shouldAutoSend = autoSendOnUpload
            && !batchMode
            && !isVideoNoteUploadRef.current
            && (isGroupChat || !extra?.hasPlaceholder);

          if (shouldAutoSend && result?.file_path && sendChatMessage) {
            const clientId = extra?.clientId || generateClientId();
            const msgData = {
              ...buildTargetFields(),
              file_path: result.file_path,
              message_type: result.message_type || extra?.messageType || 'file',
              client_id: clientId,
              duration: extra?.duration,
              reply_to_id: replyingToMessage ? replyingToMessage.id : null
            };

            setMessages(prev => [buildOptimisticMessage(msgData, currentUserId, replyingToMessage), ...prev]);
            setReplyingToMessage(null);
            sendChatMessage(msgData);
          } else if (isGroupChat && isVideoNoteUploadRef.current && result?.file_path && sendChatMessage) {
            // Видеосообщение в группе — после аплоада шлём сами
            const clientId = extra?.clientId || generateClientId();
            const msgData = {
              ...buildTargetFields(),
              file_path: result.file_path,
              message_type: 'video_note',
              client_id: clientId,
              duration: extra?.duration,
              reply_to_id: replyingToMessage ? replyingToMessage.id : null
            };
            setMessages(prev => [buildOptimisticMessage(msgData, currentUserId, replyingToMessage), ...prev]);
            setReplyingToMessage(null);
            sendChatMessage(msgData);
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
  }, [activeUploadId, userId, groupId, autoSendOnUpload, replyingToMessage, isGroupChat, sendChatMessage, batchMode]);

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
        uploadReceiverId,
        (uid) => {
          setActiveUploadId(uid);
        },
        {}, // apiOptions
        // В группе нет personal placeholder — hasPlaceholder только для личных
        { clientId, hasPlaceholder: !isGroupChat, type: mt, messageType: mt }
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
    if (attachmentsLocal.length === 0 || !sendChatMessage) return;

    const isSingle = attachmentsLocal.length === 1;
    const msgData = isSingle
      ? {
          ...buildTargetFields(),
          file_path: attachmentsLocal[0].file_path,
          message_type: attachmentsLocal[0].type,
          client_id: clientId,
          reply_to_id: replyingToMessage ? replyingToMessage.id : null,
        }
      : {
          ...buildTargetFields(),
          attachments: attachmentsLocal,
          message_type: 'media_group',
          client_id: clientId,
          reply_to_id: replyingToMessage ? replyingToMessage.id : null,
        };

    // В личном чате одиночный файл уже закрывается placeholder'ом на бэке.
    // В группе placeholder'а нет — всегда отправляем сами. Media_group — всегда сами.
    if (!isSingle || isGroupChat) {
      setMessages(prev => [buildOptimisticMessage(msgData, currentUserId, replyingToMessage), ...prev]);
      sendChatMessage(msgData);
      setReplyingToMessage(null);
    }
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
        uploadReceiverId,
        (id) => {
          setActiveUploadId(id);
        },
        {}, // apiOptions
        { clientId, hasPlaceholder: !isGroupChat, isVideoNote: true, type: 'video_note', messageType: 'video_note', duration }
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
        uploadReceiverId,
        (upload_id) => {
          setActiveUploadId(upload_id);
        },
        {}, // apiOptions
        { clientId, hasPlaceholder: !isGroupChat, type: 'voice', messageType: 'voice', duration }
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
