import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Platform, Keyboard } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import * as Haptics from 'expo-haptics';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useNotifications } from '../../context/NotificationContext';
import { useTheme } from '../../context/ThemeContext';
import { theme as themeConstants } from '../../constants/theme';
import { groupChatApi } from '../../api';

import { styles } from './styles';
import { generateClientId, buildOptimisticMessage, HISTORY_LIMIT } from './utils';
import useChatUploads from './hooks/useChatUploads';
import useMessageSelection from './hooks/useMessageSelection';
import useFullScreenMedia from './hooks/useFullScreenMedia';
import useVoiceRecording from './hooks/useVoiceRecording';
import useVideoNoteRecording from './hooks/useVideoNoteRecording';
import ChatHeader from './components/ChatHeader';
import ForwardMessageModal from './components/ForwardMessageModal';
import MessageItem from './components/MessageItem';
import UploadPlaceholder from './components/UploadPlaceholder';
import UploadProgressBanner from './components/UploadProgressBanner';
import FullScreenMediaViewer from './components/FullScreenMediaViewer';
import ChatInputBar from './components/ChatInputBar';
import VideoRecordingOverlay from './components/VideoRecordingOverlay';

// Полнофункциональный групповой чат: те же компоненты/хуки, что и личный ChatScreen
// (ответы, пересылка, реакции, удаление, вложения, разделители дат, выделение).
export default function GroupChatScreen({ route, navigation }) {
  const { groupId, groupName: initialGroupName } = route.params;
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const {
    currentUserId, currentUser, dialogs, notifications, isChatConnected,
    sendMessage: sendMessageWs,
    sendGroupMessageWs, getGroupHistoryWs,
    onGroupHistoryReceived, onGroupMessageReceived,
    deleteMessageWs, bulkDeleteMessagesWs, toggleReactionWs,
    setActiveChatId,
  } = useNotifications();

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [replyingToMessage, setReplyingToMessage] = useState(null);
  const [pendingForwardMessages, setPendingForwardMessages] = useState(null);
  const [inputMode, setInputMode] = useState('audio');
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const [viewableItems, setViewableItems] = useState([]);
  const [showScrollDownButton, setShowScrollDownButton] = useState(false);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [groupName, setGroupName] = useState(initialGroupName || 'Группа');
  const [membersCount, setMembersCount] = useState(null);
  const [myRole, setMyRole] = useState('member');

  const textInputRef = useRef(null);
  const chatFlatListRef = useRef(null);
  const isMounted = useRef(true);
  const lastProcessedNotificationRef = useRef(null);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const canModerate = myRole === 'owner' || myRole === 'admin';

  // Метаданные группы (название, число участников, роль)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const res = await groupChatApi.getGroup(groupId);
          if (cancelled || !res?.data) return;
          setGroupName(res.data.name || initialGroupName || 'Группа');
          setMembersCount(Array.isArray(res.data.members) ? res.data.members.length : null);
          setMyRole(res.data.my_role || 'member');
        } catch (e) {
          console.log('[GroupChatScreen] Failed to load group meta:', e);
        }
      })();
      return () => { cancelled = true; };
    }, [groupId, initialGroupName])
  );

  const uploads = useChatUploads({
    userId: null,
    currentUserId,
    sendMessageWs,
    sendGroupMessageWs,
    groupId,
    isChatConnected,
    setMessages,
    replyingToMessage,
    setReplyingToMessage,
    isMounted,
  });

  const selection = useMessageSelection({
    messages,
    setMessages,
    setSkip,
    userId: null,
    currentUserId,
    currentUser,
    interlocutor: null,
    dialogs,
    navigation,
    deleteMessageWs,
    bulkDeleteMessagesWs,
    sendMessageWs,
    toggleReactionWs,
    isGroupChat: true,
    canModerate,
  });
  const { selectionMode, selectedIds } = selection;

  const { openFullScreen, viewerProps } = useFullScreenMedia({ messages, chatFlatListRef });
  const voice = useVoiceRecording({ isMounted });
  const videoNote = useVideoNoteRecording();

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Активный чат: помечаем group:id, чтобы пуши/баннеры могли отличать группу
  useEffect(() => {
    setActiveChatId?.(`group_${groupId}`);
    return () => setActiveChatId?.(null);
  }, [groupId, setActiveChatId]);

  // Pending forward из навигации (если когда-нибудь пересылка в группу появится)
  useEffect(() => {
    if (route.params?.pendingForwardMessages) {
      setPendingForwardMessages(route.params.pendingForwardMessages);
      navigation.setParams({ pendingForwardMessages: undefined });
    }
  }, [route.params?.pendingForwardMessages]);

  // История группы
  useFocusEffect(
    useCallback(() => {
      setSkip(0);
      setHasMore(true);
      getGroupHistoryWs(groupId, HISTORY_LIMIT, 0);
    }, [groupId, getGroupHistoryWs])
  );

  useEffect(() => {
    if (isChatConnected && groupId) {
      getGroupHistoryWs(groupId, HISTORY_LIMIT, 0);
    }
  }, [isChatConnected, groupId, getGroupHistoryWs]);

  useEffect(() => {
    const unsubHistory = onGroupHistoryReceived((payload) => {
      if (Number(payload.group_id) !== Number(groupId)) return;
      const batch = payload.data || [];
      setMessages(prev => {
        if (payload.skip === 0) {
          const pending = prev.filter(m => m.status === 'pending');
          // История с бэка уже desc (новые первые) — как нужно для inverted FlatList
          const merged = [...batch];
          pending.forEach(p => {
            if (!merged.some(m => m.client_id && m.client_id === p.client_id)) {
              merged.unshift(p);
            }
          });
          return merged;
        }
        // Догрузка старых
        const existingIds = new Set(prev.map(m => String(m.id)));
        const older = batch.filter(m => !existingIds.has(String(m.id)));
        return [...prev, ...older];
      });
      setSkip(payload.skip || 0);
      setHasMore(batch.length >= HISTORY_LIMIT);
      setLoadingMore(false);
    });

    const unsubMessage = onGroupMessageReceived((message) => {
      if (Number(message.group_id) !== Number(groupId)) return;
      setMessages(prev => {
        if (message.client_id) {
          const existingIndex = prev.findIndex(m =>
            m.client_id === message.client_id || String(m.id) === String(message.client_id)
          );
          if (existingIndex !== -1) {
            const next = [...prev];
            next[existingIndex] = { ...message, status: 'sent' };
            return next;
          }
        }
        if (message.id && prev.some(m => String(m.id) === String(message.id))) {
          return prev.map(m => String(m.id) === String(message.id) ? { ...m, ...message, status: 'sent' } : m);
        }
        return [{ ...message, status: 'sent' }, ...prev];
      });
    });

    return () => {
      unsubHistory();
      unsubMessage();
    };
  }, [groupId, onGroupHistoryReceived, onGroupMessageReceived]);

  // Удаления и реакции через общий поток notifications (как в useChatHistory)
  useEffect(() => {
    if (!notifications || notifications.length === 0) return;

    const lastIdx = lastProcessedNotificationRef.current
      ? notifications.findIndex(n => n === lastProcessedNotificationRef.current)
      : -1;
    const newNotifications = lastIdx === -1 ? notifications : notifications.slice(0, lastIdx);

    [...newNotifications].reverse().forEach(lastNotify => {
      const data = lastNotify.data;
      if (!data) return;
      const notifyType = lastNotify.type || lastNotify.msg_type;

      if (notifyType === 'message_deleted') {
        const msgId = data.message_id || data.id || lastNotify.message_id;
        const eventGroupId = data.group_id ?? lastNotify.group_id;
        // Если group_id указан — фильтруем по группе; если нет — удаляем по id (как в личном)
        if (eventGroupId != null && Number(eventGroupId) !== Number(groupId)) return;
        if (msgId) {
          setMessages(prev => prev.filter(m => String(m.id) !== String(msgId)));
        }
      } else if (notifyType === 'reaction_updated') {
        const msgId = lastNotify.message_id ?? data.message_id;
        const reactions = lastNotify.reactions ?? data.reactions;
        const eventGroupId = data.group_id ?? lastNotify.group_id;
        if (eventGroupId != null && Number(eventGroupId) !== Number(groupId)) return;
        if (msgId !== undefined && msgId !== null) {
          setMessages(prev => prev.map(m => (
            String(m.id) === String(msgId) ? { ...m, reactions } : m
          )));
        }
      }
    });

    lastProcessedNotificationRef.current = notifications[0];
  }, [notifications, groupId]);

  const loadMoreMessages = () => {
    if (loadingMore || !hasMore) return;
    const nextSkip = skip + HISTORY_LIMIT;
    setLoadingMore(true);
    getGroupHistoryWs(groupId, HISTORY_LIMIT, nextSkip);
  };

  const handleReply = (message) => {
    setReplyingToMessage(message);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    textInputRef.current?.focus();
  };

  const handleCancelForward = () => setPendingForwardMessages(null);

  const sendMessage = async () => {
    if (selectionMode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (pendingForwardMessages && pendingForwardMessages.length > 0) {
      const commentText = inputText.trim();
      const lastIdx = pendingForwardMessages.length - 1;
      pendingForwardMessages.forEach((msgData, idx) => {
        const base = {
          ...msgData,
          group_id: groupId,
          receiver_id: undefined,
        };
        const finalMsgData = (commentText && idx === lastIdx)
          ? { ...base, comment: commentText }
          : base;
        setMessages(prev => [buildOptimisticMessage(finalMsgData, currentUserId), ...prev]);
        sendGroupMessageWs(finalMsgData);
      });
      setPendingForwardMessages(null);
      setInputText('');
      return;
    }

    if (inputText.trim()) {
      const msgData = {
        group_id: groupId,
        message: inputText.trim(),
        message_type: 'text',
        client_id: generateClientId(),
        reply_to_id: replyingToMessage ? replyingToMessage.id : null,
      };
      setMessages(prev => [buildOptimisticMessage(msgData, currentUserId, replyingToMessage), ...prev]);
      setInputText('');
      setReplyingToMessage(null);
      sendGroupMessageWs(msgData);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handlePickDocument = () => {
    if (selectionMode) return;
    uploads.pickAndUploadDocument();
  };

  const handlePickMedia = () => {
    if (selectionMode) return;
    uploads.pickAndUploadFile();
  };

  const handleSendVoice = async () => {
    const ok = await uploads.uploadVoiceMessage(voice.recordedUri, voice.recordingDuration);
    if (ok) voice.resetRecording();
  };

  const handleSendVideoNote = () => {
    uploads.handleSendVideoNote(videoNote.pendingVideoNoteUri, videoNote.pendingVideoNoteDuration);
    videoNote.clearPendingVideoNote();
  };

  const scrollToBottom = () => {
    chatFlatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const handleScroll = (event) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    if (offsetY > 300) {
      if (!showScrollDownButton) setShowScrollDownButton(true);
    } else if (showScrollDownButton) {
      setShowScrollDownButton(false);
    }
  };

  const onViewableItemsChanged = useRef(({ viewableItems: viewable }) => {
    setViewableItems(viewable.map(v => String(v.item.id || v.item.client_id)));
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const renderMessageItem = ({ item, index }) => (
    <MessageItem
      item={item}
      prevMsg={messages[index + 1]}
      userId={null}
      currentUserId={currentUserId}
      colors={colors}
      selectionMode={selectionMode}
      isSelected={selectedIds.includes(item.id)}
      isCurrentSearchResult={false}
      isReplyHighlighted={false}
      isParentVisible={viewableItems.includes(String(item.id || item.client_id))}
      uploadingProgress={uploads.uploadingProgress}
      uploadingData={uploads.uploadingData}
      searchQuery=""
      isSearching={false}
      onPress={selection.handlePressMessage}
      onLongPress={selection.handleLongPressMessage}
      onReply={handleReply}
      onOpenFullScreen={openFullScreen}
      onScrollToMessage={() => {}}
      navigation={navigation}
      showReactionBar={selectionMode && selectedIds.length === 1 && selectedIds[0] === item.id}
      onReact={selection.handleReact}
      isGroupChat
    />
  );

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.container, { backgroundColor: colors.background, flex: 1 }]}
      keyboardVerticalOffset={0}
    >
      <ChatHeader
        colors={colors}
        insets={insets}
        navigation={navigation}
        isGroupChat
        groupId={groupId}
        groupName={groupName}
        membersCount={membersCount}
        onGroupInfoPress={() => navigation.navigate('GroupInfo', { groupId })}
        selectionMode={selectionMode}
        selectedIds={selectedIds}
        onClearSelection={selection.clearSelection}
        onBulkDelete={selection.handleBulkDelete}
        onForward={selection.openForwardModal}
        isSearching={false}
        searchQuery=""
        onSearchChange={() => {}}
        isLoadingSearchResults={false}
        globalSearchResults={[]}
        currentGlobalSearchIdx={0}
        onPrevResult={() => {}}
        onNextResult={() => {}}
        onToggleSearch={() => {}}
      />

      {!isChatConnected && (
        <View style={[styles.offlineBanner, { backgroundColor: colors.error + '22' }]}>
          <MaterialIcons name="cloud-off" size={16} color={colors.error} />
          <Text style={[styles.offlineText, { color: colors.error }]}>
            Соединение потеряно. Сообщения будут отправлены позже.
          </Text>
        </View>
      )}

      <UploadProgressBanner
        uploadingProgress={uploads.uploadingProgress}
        uploadingData={uploads.uploadingData}
        activeUploadId={uploads.activeUploadId}
        batchMode={uploads.batchMode}
        batchTotal={uploads.batchTotal}
        attachmentsLocalCount={uploads.attachmentsLocalCount}
        onCancel={uploads.handleCancelUpload}
        colors={colors}
      />

      <FlatList
        ref={chatFlatListRef}
        data={messages}
        extraData={[
          messages,
          messages.length,
          currentUserId,
          selectedIds,
          selectedIds.length,
          theme,
          groupId,
          viewableItems,
          uploads.uploadingProgress,
          uploads.uploadingData,
          uploads.activeUploadId,
        ]}
        keyExtractor={(item) => `gmsg_${item.id !== undefined && item.id !== null ? String(item.id) : (item.client_id || Math.random())}`}
        renderItem={renderMessageItem}
        onEndReached={loadMoreMessages}
        onEndReachedThreshold={0.1}
        inverted
        ListHeaderComponent={
          <UploadPlaceholder
            uploadingProgress={uploads.uploadingProgress}
            uploadingData={uploads.uploadingData}
            activeUploadId={uploads.activeUploadId}
            onCancel={uploads.handleCancelUpload}
            colors={colors}
          />
        }
        onViewableItemsChanged={onViewableItemsChanged}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        viewabilityConfig={viewabilityConfig}
        removeClippedSubviews={false}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={10}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
      />

      {showScrollDownButton && (
        <TouchableOpacity
          style={[styles.scrollDownButton, { backgroundColor: colors.surface }]}
          onPress={scrollToBottom}
        >
          <MaterialIcons name="keyboard-arrow-down" size={30} color={colors.text} />
        </TouchableOpacity>
      )}

      <FullScreenMediaViewer {...viewerProps} />

      <ForwardMessageModal
        visible={selection.isForwardModalVisible}
        dialogs={dialogs || []}
        colors={colors}
        onClose={selection.closeForwardModal}
        onForward={selection.handleForward}
      />

      {!selectionMode && (
        <ChatInputBar
          colors={colors}
          insets={insets}
          isKeyboardVisible={isKeyboardVisible}
          currentUserId={currentUserId}
          interlocutor={null}
          inputText={inputText}
          onChangeText={setInputText}
          textInputRef={textInputRef}
          onSendMessage={sendMessage}
          replyingToMessage={replyingToMessage}
          onCancelReply={() => setReplyingToMessage(null)}
          pendingForwardMessages={pendingForwardMessages}
          onCancelForward={handleCancelForward}
          onPickDocument={handlePickDocument}
          onPickMedia={handlePickMedia}
          inputMode={inputMode}
          onToggleInputMode={() => setInputMode(prev => prev === 'audio' ? 'video' : 'audio')}
          isRecording={voice.isRecording}
          recordedUri={voice.recordedUri}
          recordingDuration={voice.recordingDuration}
          recorderStatus={voice.recorderStatus}
          recordingDotOpacity={voice.recordingDotOpacity}
          onStartRecording={voice.startRecording}
          onStopRecording={voice.stopRecording}
          onDeleteRecording={voice.deleteRecording}
          onSendVoice={handleSendVoice}
          isVideoRecording={videoNote.isVideoRecording}
          pendingVideoNoteUri={videoNote.pendingVideoNoteUri}
          onStartVideoRecording={videoNote.startVideoRecording}
          onStopVideoRecording={videoNote.stopVideoRecording}
          onDiscardVideoNote={videoNote.clearPendingVideoNote}
          onSendVideoNote={handleSendVideoNote}
        />
      )}

      {videoNote.isVideoRecording && (
        <VideoRecordingOverlay cameraRef={videoNote.cameraRef} timerSeconds={videoNote.videoRecordingTimer} />
      )}
    </KeyboardAvoidingView>
  );
}
