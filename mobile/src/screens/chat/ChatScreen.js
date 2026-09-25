import React, { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import notifee from '@notifee/react-native';
import * as Haptics from 'expo-haptics';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { storage } from '../../utils/storage';
import { useNotifications } from '../../context/NotificationContext';
import { useTheme } from '../../context/ThemeContext';
import { theme as themeConstants } from '../../constants/theme';

import { styles } from './styles';
import { generateClientId, buildOptimisticMessage } from './utils';
import useTypingIndicator from './hooks/useTypingIndicator';
import useChatUploads from './hooks/useChatUploads';
import useChatHistory from './hooks/useChatHistory';
import useMessageSelection from './hooks/useMessageSelection';
import useChatSearch from './hooks/useChatSearch';
import useFullScreenMedia from './hooks/useFullScreenMedia';
import useVoiceRecording from './hooks/useVoiceRecording';
import useVideoNoteRecording from './hooks/useVideoNoteRecording';
import ChatHeader from './components/ChatHeader';
import MessageItem from './components/MessageItem';
import UploadPlaceholder from './components/UploadPlaceholder';
import UploadProgressBanner from './components/UploadProgressBanner';
import FullScreenMediaViewer from './components/FullScreenMediaViewer';
import ChatInputBar from './components/ChatInputBar';
import VideoRecordingOverlay from './components/VideoRecordingOverlay';

export default function ChatScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const {
    setActiveChatId, fetchDialogs, currentUserId, notifications, dialogs, clearUnread, currentUser,
    sendMessage: sendMessageWs, markAsReadWs, deleteMessageWs, bulkDeleteMessagesWs, getHistoryWs,
    onHistoryReceived, onSearchResultsReceived, searchMessagesWs, getCachedHistory, isChatConnected,
    typingUsers, sendTypingStatus,
  } = useNotifications();
  const { userId, userName } = route.params;

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [replyingToMessage, setReplyingToMessage] = useState(null);
  const [inputMode, setInputMode] = useState('audio'); // 'audio' or 'video'
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const [viewableItems, setViewableItems] = useState([]);
  const [showScrollDownButton, setShowScrollDownButton] = useState(false);

  const textInputRef = useRef(null);
  const chatFlatListRef = useRef(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const isPartnerTyping = useTypingIndicator({ inputText, userId, sendTypingStatus, typingUsers });

  const uploads = useChatUploads({
    userId,
    currentUserId,
    sendMessageWs,
    isChatConnected,
    setMessages,
    replyingToMessage,
    setReplyingToMessage,
    isMounted,
  });

  const history = useChatHistory({
    userId,
    currentUserId,
    currentUser,
    dialogs,
    notifications,
    setMessages,
    fetchDialogs,
    clearUnread,
    markAsReadWs,
    getHistoryWs,
    onHistoryReceived,
    getCachedHistory,
    isChatConnected,
    restoreActiveUploads: uploads.restoreActiveUploads,
  });
  const { interlocutor, loadMoreMessages } = history;

  const selection = useMessageSelection({
    messages,
    setMessages,
    setSkip: history.setSkip,
    userId,
    currentUserId,
    deleteMessageWs,
    bulkDeleteMessagesWs,
  });
  const { selectionMode, selectedIds } = selection;

  const search = useChatSearch({
    userId,
    messages,
    hasMore: history.hasMore,
    loadingMore: history.loadingMore,
    loadMoreMessages,
    chatFlatListRef,
    onSearchResultsReceived,
    searchMessagesWs,
  });

  const { openFullScreen, viewerProps } = useFullScreenMedia({ messages, chatFlatListRef });

  const voice = useVoiceRecording({ isMounted });
  const videoNote = useVideoNoteRecording();

  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener(
      'keyboardDidShow',
      () => setKeyboardVisible(true)
    );
    const keyboardDidHideListener = Keyboard.addListener(
      'keyboardDidHide',
      () => setKeyboardVisible(false)
    );

    return () => {
      keyboardDidHideListener.remove();
      keyboardDidShowListener.remove();
    };
  }, []);

  // Обозначаем активный чат в контексте уведомлений и гарантируем восстановление WS уведомлений при выходе
  useEffect(() => {
    console.log('[ChatScreen] Active chat set to:', userId);
    setActiveChatId(userId);

    // Очищаем уведомления и локальную историю для этого пользователя при входе в чат
    if (Platform.OS !== 'web') {
      try {
        notifee.cancelNotification(`sender_${userId}`).catch(() => {});
        notifee.cancelNotification(`group_sender_${userId}`).catch(() => {});
        storage.removeItem(`notif_messages_${userId}`).catch(() => {});
      } catch (e) {
        console.log('[ChatScreen] Error canceling notification/history:', e);
      }
    }

    return () => {
      console.log('[ChatScreen] Active chat cleared (was', userId, ')');
      setActiveChatId(null);
    };
  }, [userId, setActiveChatId]);

  const handleReply = (message) => {
    setReplyingToMessage(message);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Фокус на TextInput
    if (textInputRef.current) {
      textInputRef.current.focus();
    }
  };

  const sendMessage = async () => {
    if (selectionMode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (inputText.trim()) {
      const msgData = {
        receiver_id: userId,
        message: inputText.trim(),
        message_type: 'text',
        client_id: generateClientId(),
        reply_to_id: replyingToMessage ? replyingToMessage.id : null
      };
      
      // Оптимистичное добавление в UI
      setMessages(prev => [buildOptimisticMessage(msgData, currentUserId, replyingToMessage), ...prev]);
      setInputText('');
      setReplyingToMessage(null);

      const sent = sendMessageWs(msgData);
      if (!sent) {
        // Если WS недоступен, сообщение уже в очереди pendingMessages в контексте,
        // но мы можем оставить его в статусе pending в UI.
        console.log('[ChatScreen] Message added to pending queue in context');
      }
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
    // Since FlatList is inverted, offsetY increases as we scroll UP (away from latest messages)
    if (offsetY > 300) {
      if (!showScrollDownButton) setShowScrollDownButton(true);
    } else {
      if (showScrollDownButton) setShowScrollDownButton(false);
    }
  };

  const onViewableItemsChanged = useRef(({ viewableItems: viewable }) => {
    setViewableItems(viewable.map(v => String(v.item.id || v.item.client_id)));
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50
  }).current;

  const renderMessageItem = ({ item, index }) => (
    <MessageItem
      item={item}
      prevMsg={messages[index + 1]} // Помним, что FlatList inverted
      userId={userId}
      currentUserId={currentUserId}
      colors={colors}
      selectionMode={selectionMode}
      isSelected={selectedIds.includes(item.id)}
      isCurrentSearchResult={search.globalSearchResults[search.currentGlobalSearchIdx]?.id === item.id}
      isReplyHighlighted={search.replyHighlightId === item.id}
      isParentVisible={viewableItems.includes(String(item.id || item.client_id))}
      uploadingProgress={uploads.uploadingProgress}
      uploadingData={uploads.uploadingData}
      searchQuery={search.searchQuery}
      isSearching={search.isSearching}
      onPress={selection.handlePressMessage}
      onLongPress={selection.handleLongPressMessage}
      onReply={handleReply}
      onOpenFullScreen={openFullScreen}
      onScrollToMessage={search.scrollToMessageById}
    />
  );

  return (
    <KeyboardAvoidingView 
      behavior="padding" 
      style={[styles.container, { backgroundColor: colors.background, flex: 1 }]}
      keyboardVerticalOffset={0}
      // Это управляемый (managed) Expo-проект без собственного AndroidManifest.xml,
      // поэтому предполагать принудительный windowSoftInputMode="adjustResize" от Expo нельзя —
      // компенсация клавиатуры должна выполняться самим KeyboardAvoidingView на обеих платформах.
      enabled={Platform.OS !== 'web'}
    >
      <ChatHeader
        colors={colors}
        insets={insets}
        navigation={navigation}
        userId={userId}
        userName={userName}
        interlocutor={interlocutor}
        isPartnerTyping={isPartnerTyping}
        selectionMode={selectionMode}
        selectedIds={selectedIds}
        onClearSelection={selection.clearSelection}
        onBulkDelete={selection.handleBulkDelete}
        isSearching={search.isSearching}
        searchQuery={search.searchQuery}
        onSearchChange={search.handleSearch}
        isLoadingSearchResults={search.isLoadingSearchResults}
        globalSearchResults={search.globalSearchResults}
        currentGlobalSearchIdx={search.currentGlobalSearchIdx}
        onPrevResult={search.prevSearchResult}
        onNextResult={search.nextSearchResult}
        onToggleSearch={search.toggleSearch}
      />
      {!isChatConnected && (
        <View style={[styles.offlineBanner, { backgroundColor: colors.error + '22' }]}>
          <MaterialIcons name="cloud-off" size={16} color={colors.error} />
          <Text style={[styles.offlineText, { color: colors.error }]}>Соединение потеряно. Сообщения будут отправлены позже.</Text>
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
          userId, 
          viewableItems, 
          uploads.uploadingProgress, 
          uploads.uploadingData, 
          uploads.activeUploadId, 
          history.token
        ]}
        keyExtractor={(item) => `msg_${item.id !== undefined && item.id !== null ? String(item.id) : (item.client_id || Math.random())}`}
        renderItem={renderMessageItem}
        onEndReached={loadMoreMessages}
        onEndReachedThreshold={0.1}
        inverted={true}
        ListHeaderComponent={
          <UploadPlaceholder
            uploadingProgress={uploads.uploadingProgress}
            uploadingData={uploads.uploadingData}
            activeUploadId={uploads.activeUploadId}
            onCancel={uploads.handleCancelUpload}
            colors={colors}
          />
        }
        onScrollToIndexFailed={(info) => {
          chatFlatListRef.current?.scrollToOffset({ 
            offset: info.averageItemLength * info.index, 
            animated: true 
          });
        }}
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

      {!selectionMode && (
        <ChatInputBar
          colors={colors}
          insets={insets}
          isKeyboardVisible={isKeyboardVisible}
          currentUserId={currentUserId}
          interlocutor={interlocutor}
          inputText={inputText}
          onChangeText={setInputText}
          textInputRef={textInputRef}
          onSendMessage={sendMessage}
          replyingToMessage={replyingToMessage}
          onCancelReply={() => setReplyingToMessage(null)}
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
