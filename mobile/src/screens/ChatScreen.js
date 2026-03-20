import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getShadow } from '../utils/shadowStyles';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image, Modal, Pressable, Alert, AppState, StatusBar, Dimensions, Share, Animated, Vibration, Keyboard, PanResponder, ActivityIndicator } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import notifee from '@notifee/react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { documentDirectory, getInfoAsync, downloadAsync, deleteAsync, readAsStringAsync, writeAsStringAsync, EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { chatApi, usersApi } from '../api';
import { API_BASE_URL } from '../constants';
import { storage } from '../utils/storage';
import { useNotifications } from '../context/NotificationContext';
import { uploadManager } from '../utils/uploadManager';
import CachedMedia from '../components/CachedMedia';
import VoiceMessage from '../components/VoiceMessage';
import FileMessage from '../components/FileMessage';
import VideoNoteMessage from '../components/VideoNoteMessage';
import VideoPlayer from '../components/VideoPlayer';
import { Audio, useAudioRecorder, useAudioRecorderState, useAudioPlayer, RecordingPresets, AudioModule, requestRecordingPermissionsAsync, createAudioPlayer } from 'expo-audio';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { formatStatus, formatName, formatFileSize, parseISODate, formatMessageTime, getAvatarUrl } from '../utils/formatters';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setRecordingAudioMode } from '../utils/audioSettings';

function VideoUploadPlaceholder({ progressPercent, activeUploadId, uri, loaded, total, onCancel }) {
  const isFinished = progressPercent >= 100;
  const progressText = isFinished ? "Обработка..." : ((loaded !== undefined && total !== undefined && total > 0) 
    ? `${formatFileSize(loaded)} / ${formatFileSize(total)}` 
    : `${progressPercent}%`);
    
  return (
    <View style={{ width: 200, height: 150, borderRadius: 10, backgroundColor: '#1a1a1a', overflow: 'hidden' }}>
      {uri && (
        <Image 
          source={{ uri }} 
          style={StyleSheet.absoluteFill} 
          resizeMode="cover" 
        />
      )}
      <View style={{
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: uri ? 'rgba(0,0,0,0.2)' : 'transparent'
      }}>
        {!uri && <MaterialIcons name="videocam" size={40} color="rgba(255,255,255,0.3)" />}
      </View>
      <View style={{
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 10,
      }}>
        <View style={{
          backgroundColor: 'rgba(0,0,0,0.6)',
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 15,
          flexDirection: 'row',
          alignItems: 'center',
        }}>
          <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>{progressText}</Text>
        </View>
        <TouchableOpacity
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: 'rgba(0,0,0,0.6)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.3)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
          onPress={() => onCancel(activeUploadId)}
        >
          <MaterialIcons name="close" size={16} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ChatScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { setActiveChatId, fetchDialogs, currentUserId, notifications, connect, dialogs, clearUnread, currentUser, sendMessage: sendMessageWs, markAsReadWs, deleteMessageWs, bulkDeleteMessagesWs, getHistoryWs, onHistoryReceived, onSearchResultsReceived, searchMessagesWs, getCachedHistory, isChatConnected } = useNotifications();
  const { userId, userName } = route.params;
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const textInputRef = useRef(null);
  const [token, setToken] = useState(null);
  const [uploadingProgress, setUploadingProgress] = useState(null);
  const [uploadingData, setUploadingData] = useState({ loaded: 0, total: 0, uri: null, mimeType: null });
  const [activeUploadId, setActiveUploadId] = useState(null);
  const [fullScreenMedia, setFullScreenMedia] = useState(null); // { index, list }
  const [allMedia, setAllMedia] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);
  // Групповая отправка медиа
  const [batchMode, setBatchMode] = useState(false);
  const [batchAttachments, setBatchAttachments] = useState([]); // [{file_path, type}]
  const [batchTotal, setBatchTotal] = useState(0);
  const [autoSendOnUpload, setAutoSendOnUpload] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [skip, setSkip] = useState(0);
  const [interlocutor, setInterlocutor] = useState(null);
  const [attachmentsLocalCount, setAttachmentsLocalCount] = useState(0);
  const [replyingToMessage, setReplyingToMessage] = useState(null);

  const [globalSearchResults, setGlobalSearchResults] = useState([]); // [{id, message, ...}]
  const [currentGlobalSearchIdx, setCurrentGlobalSearchIdx] = useState(-1);
  const [isLoadingSearchResults, setIsLoadingSearchResults] = useState(false);
  const pendingScrollToId = useRef(null);

  useEffect(() => {
    const unsubscribe = onSearchResultsReceived((payload) => {
      if (Number(payload.other_user_id) === Number(userId)) {
        console.log('[ChatScreen] Global search results received:', payload.data?.length);
        setGlobalSearchResults(payload.data || []);
        setIsLoadingSearchResults(false);
        if (payload.data && payload.data.length > 0) {
          setCurrentGlobalSearchIdx(0);
          scrollToMessageById(payload.data[0].id);
        } else {
          setCurrentGlobalSearchIdx(-1);
        }
      }
    });
    return () => unsubscribe();
  }, [userId, onSearchResultsReceived]);

  const [replyHighlightId, setReplyHighlightId] = useState(null);

  const scrollToMessageById = (messageId) => {
    // Check if we have this message loaded
    const index = messages.findIndex(m => m.id === messageId);
    if (index !== -1) {
      setReplyHighlightId(messageId);
      scrollToMessage(index);
      setTimeout(() => setReplyHighlightId(null), 2000);
    } else {
      // Message not loaded yet, need to fetch more history
      console.log(`[ChatScreen] Message ${messageId} not in local list, requesting more history...`);
      pendingScrollToId.current = messageId;
      loadMoreMessages();
    }
  };

  useEffect(() => {
    if (pendingScrollToId.current) {
      const index = messages.findIndex(m => m.id === pendingScrollToId.current);
      if (index !== -1) {
        console.log(`[ChatScreen] Found pending message ${pendingScrollToId.current} at index ${index}`);
        const id = pendingScrollToId.current;
        pendingScrollToId.current = null;
        setReplyHighlightId(id);
        scrollToMessage(index);
        setTimeout(() => setReplyHighlightId(null), 2000);
      } else if (!hasMore && !loadingMore) {
        // We reached the end of history and still didn't find the message
        console.log(`[ChatScreen] Could not find message ${pendingScrollToId.current} in full history`);
        pendingScrollToId.current = null;
      } else if (!loadingMore) {
        // Keep loading more if we have more
        loadMoreMessages();
      }
    }
  }, [messages, loadingMore, hasMore]);

  const handleReply = (message) => {
    setReplyingToMessage(message);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Фокус на TextInput
    if (textInputRef.current) {
      textInputRef.current.focus();
    }
  };
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [inputMode, setInputMode] = useState('audio'); // 'audio' or 'video'
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [pendingVideoNoteUri, setPendingVideoNoteUri] = useState(null);
  const cameraRef = useRef(null);
  const [recordedUri, setRecordedUri] = useState(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const isStartingRecording = useRef(false);
  const stopRequested = useRef(false);
  const isMounted = useRef(true);
  const isVideoNoteUploadRef = useRef(false);
  const LIMIT = 15;
  const lastProcessedNotificationId = useRef(null);
  const lastProcessedMsgId = useRef(null);

  const handleCancelUpload = useCallback((uploadId) => {
    if (!uploadId) return;
    console.log('[ChatScreen] Cancelling upload:', uploadId);
    uploadManager.cancelUpload(uploadId);
    if (isChatConnected) {
      sendMessageWs({ type: 'upload_cancelled', upload_id: uploadId });
    }
    setUploadingProgress(null);
    setActiveUploadId(null);
    setUploadingData({ loaded: 0, total: 0, uri: null, mimeType: null });
  }, [isChatConnected, sendMessageWs]);

  // Слушаем новые уведомления (сообщения) в реальном времени
  useEffect(() => {
    if (notifications && notifications.length > 0) {
      const latest = notifications[0];
      if ((latest.type === 'new_message' || latest.type === 'message') && latest.data) {
        // Чтобы не обрабатывать одно и то же уведомление дважды при ререндерах
        const notifId = latest.data.id || latest.data.client_id;
        if (lastProcessedNotificationId.current === notifId) return;
        lastProcessedNotificationId.current = notifId;

        const msg = latest.data;
        const isFromMe = Number(msg.sender_id) === Number(currentUserId);
        const otherId = isFromMe ? Number(msg.receiver_id) : Number(msg.sender_id);

        if (Number(otherId) === Number(userId)) {
          // Не добавляем в список собственные плейсхолдеры загрузки, у нас для этого есть локальный индикатор
          if ((latest.type === 'new_message' || latest.type === 'message') && msg?.is_uploading && isFromMe) {
            console.log('[ChatScreen] Skipping own upload placeholder message');
            return;
          }
          console.log('[ChatScreen] New real-time message received from notifications:', msg.id || msg.client_id, 'type:', latest.type);
          setMessages(prev => {
            // Если это наше сообщение (есть client_id), ищем его в pending и обновляем
            if (isFromMe && msg.client_id) {
              const pendingIdx = prev.findIndex(m => m.client_id === msg.client_id && m.status === 'pending');
              if (pendingIdx !== -1) {
                console.log('[ChatScreen] Updating pending message to sent:', msg.client_id);
                const newMsgs = [...prev];
                newMsgs[pendingIdx] = { ...msg, status: 'sent' };
                return newMsgs;
              }
            }

            // Проверка на дубликаты (по id или client_id)
            const exists = prev.some(m => 
              (msg.id && String(m.id) === String(msg.id)) || 
              (msg.client_id && m.client_id === msg.client_id && m.status !== 'pending')
            );
            
            if (!exists) {
              console.log('[ChatScreen] Adding new message to list from real-time:', msg.id || msg.client_id);
              return [msg, ...prev];
            }
            return prev;
          });
        }
      }
    }
  }, [notifications, userId, currentUserId]);

  // Отслеживаем прогресс загрузки и завершение (message_updated) от Chat WS
  const lastProcessedUploadNotifyRef = useRef(null);
  useEffect(() => {
    if (!notifications || notifications.length === 0) return;
    
    const lastIdx = lastProcessedUploadNotifyRef.current 
      ? notifications.findIndex(n => n === lastProcessedUploadNotifyRef.current)
      : -1;
    const newNotifications = lastIdx === -1 ? notifications : notifications.slice(0, lastIdx);

    newNotifications.forEach(notify => {
      if (notify.type === 'upload_progress' && notify.data) {
        const { message_id, progress, offset, total } = notify.data;
        setMessages(prev => prev.map(m => (String(m.id) === String(message_id) 
          ? { ...m, is_uploading: true, upload_progress: progress, upload_offset: offset, upload_total: total } 
          : m
        )));
      } else if (notify.type === 'message_updated' && notify.data) {
        const up = notify.data;
        setMessages(prev => prev.map(m => (String(m.id) === String(up.id) ? { ...m, file_path: up.file_path, message_type: up.message_type, is_uploading: false, upload_progress: undefined } : m)));
      }
    });

    lastProcessedUploadNotifyRef.current = notifications[0];
  }, [notifications]);
  const videoPlayerRef = useRef(null);
  const chatFlatListRef = useRef(null);
  const recordingOptions = useMemo(() => RecordingPresets.HIGH_QUALITY, []);
  const recorder = useAudioRecorder(recordingOptions);
  const recorderStatus = useAudioRecorderState(recorder, 200);

  const screenWidth = Dimensions.get('window').width;
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [showFullScreenControls, setShowFullScreenControls] = useState(true);
  const fullScreenPlayersByIndex = useRef(new Map());
  const fullScreenPlayerSubscriptions = useRef([]);
  const [fullScreenPosition, setFullScreenPosition] = useState(0);
  const [fullScreenDuration, setFullScreenDuration] = useState(0);
  const [fullScreenIsPlaying, setFullScreenIsPlaying] = useState(false);
  const [fullScreenPlaybackRate, setFullScreenPlaybackRate] = useState(1);
  const [fullScreenSliderWidth, setFullScreenSliderWidth] = useState(1);
  const [isVideoNoteModalVisible, setIsVideoNoteModalVisible] = useState(false);
  const [activeVideoNote, setActiveVideoNote] = useState(null);
  const [isSeekingFullScreen, setIsSeekingFullScreen] = useState(false);
  const [seekingPositionFullScreen, setSeekingPositionFullScreen] = useState(null);
  const recordingDotOpacity = useRef(new Animated.Value(1)).current;
  const fsSliderWidthRef = useRef(1);
  const fsDurationRef = useRef(0);
  const fsSeekingPosRef = useRef(null);
  const fsPositionRef = useRef(0);
  const fsIsSeekingRef = useRef(false);
  const currentMediaIndexRef = useRef(0);
  const seekFullScreenToRatioRef = useRef(null);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const [viewableItems, setViewableItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]); // Array of indices
  const [currentSearchResultIndex, setCurrentSearchResultIndex] = useState(-1);
  const [showScrollDownButton, setShowScrollDownButton] = useState(false);
  const searchTimeoutRef = useRef(null);

  const handleSearch = (text) => {
    setSearchQuery(text);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      performSearch(text);
    }, 400);
  };

  const performSearch = (text) => {
    if (!text.trim()) {
      setGlobalSearchResults([]);
      setCurrentGlobalSearchIdx(-1);
      return;
    }

    setIsLoadingSearchResults(true);
    searchMessagesWs(userId, text.trim());
  };

  const prevSearchResult = () => {
    if (globalSearchResults.length === 0) return;
    const prevIdx = (currentGlobalSearchIdx - 1 + globalSearchResults.length) % globalSearchResults.length;
    setCurrentGlobalSearchIdx(prevIdx);
    scrollToMessageById(globalSearchResults[prevIdx].id);
  };

  const nextSearchResult = () => {
    if (globalSearchResults.length === 0) return;
    const nextIdx = (currentGlobalSearchIdx + 1) % globalSearchResults.length;
    setCurrentGlobalSearchIdx(nextIdx);
    scrollToMessageById(globalSearchResults[nextIdx].id);
  };

  const scrollToMessage = (index) => {
    if (index < 0 || index >= messages.length) return;
    
    // Ensure the index is within range for the current list
    const safeIndex = Math.min(index, messages.length - 1);
    
    // Use a small delay to ensure the list is ready
    setTimeout(() => {
      if (chatFlatListRef.current) {
        try {
          chatFlatListRef.current.scrollToIndex({
            index: safeIndex,
            animated: true,
            viewPosition: 0.5
          });
        } catch (e) {
          console.warn('scrollToIndex failed, falling back to scrollToOffset', e);
          // Fallback: estimate offset based on average item height (approx 100 in chat)
          // Since it is inverted, offset 0 is at the bottom (latest message)
          chatFlatListRef.current.scrollToOffset({
            offset: safeIndex * 100,
            animated: true
          });
        }
      }
    }, 100);
  };

  const toggleSearch = () => {
    if (isSearching) {
      setIsSearching(false);
      setSearchQuery('');
      setGlobalSearchResults([]);
      setCurrentGlobalSearchIdx(-1);
      pendingScrollToId.current = null;
    } else {
      setIsSearching(true);
    }
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

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    setViewableItems(viewableItems.map(v => v.item.id));
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50
  }).current;

  const formatMediaTime = (seconds) => {
    const totalSeconds = Math.floor(seconds || 0);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  };

  const cleanupFullScreenPlayerSubscriptions = () => {
    try {
      (fullScreenPlayerSubscriptions.current || []).forEach((sub) => {
        if (sub && typeof sub.remove === 'function') sub.remove();
      });
    } catch (e) {
      // no-op
    }
    fullScreenPlayerSubscriptions.current = [];
  };

  const attachFullScreenPlayer = (player) => {
    if (!player) return;

    cleanupFullScreenPlayerSubscriptions();

    try {
      player.timeUpdateEventInterval = 0.25;
    } catch (e) {
      // no-op
    }

    fsPositionRef.current = player.currentTime || 0;
    setFullScreenPosition(player.currentTime || 0);
    fsDurationRef.current = player.duration || 0;
    setFullScreenDuration(player.duration || 0);
    setFullScreenIsPlaying(!!player.playing);
    setFullScreenPlaybackRate(player.playbackRate || 1);

    const subs = [];
    try {
      if (typeof player.addListener === 'function') {
        subs.push(
          player.addListener('timeUpdate', (payload) => {
            if (fsIsSeekingRef.current) return;
            const ct = payload?.currentTime ?? player.currentTime;
            fsPositionRef.current = ct || 0;
            setFullScreenPosition(ct || 0);
          })
        );
        subs.push(
          player.addListener('sourceLoad', (payload) => {
            const dur = payload?.duration ?? player.duration;
            fsDurationRef.current = dur || 0;
            setFullScreenDuration(dur || 0);
          })
        );
        subs.push(
          player.addListener('playingChange', (payload) => {
            setFullScreenIsPlaying(!!payload?.isPlaying);
          })
        );
        subs.push(
          player.addListener('playbackRateChange', (payload) => {
            setFullScreenPlaybackRate(payload?.playbackRate ?? player.playbackRate);
          })
        );
      }
    } catch (e) {
      // no-op
    }
    fullScreenPlayerSubscriptions.current = subs;
  };

  const getActiveFullScreenPlayer = () => {
    return fullScreenPlayersByIndex.current.get(currentMediaIndex) || null;
  };

  const toggleFullScreenControls = () => {
    setShowFullScreenControls((prev) => !prev);
  };

  const handleFullScreenPlayPause = () => {
    const player = getActiveFullScreenPlayer();
    if (!player) return;

    try {
      if (player.playing) {
        player.pause();
        return;
      }

      // If reached end, restart before play
      const dur = player.duration || fullScreenDuration || 0;
      const pos = player.currentTime || fullScreenPosition || 0;
      if (dur > 0 && pos >= dur) {
        player.currentTime = 0;
      }
      player.play();
    } catch (e) {
      console.log('[FullScreenVideo] play/pause failed', e);
    }
  };

  const handleFullScreenToggleRate = () => {
    const player = getActiveFullScreenPlayer();
    if (!player) return;
    const nextRate = fullScreenPlaybackRate === 1 ? 1.5 : (fullScreenPlaybackRate === 1.5 ? 2 : 1);
    try {
      player.playbackRate = nextRate;
      setFullScreenPlaybackRate(nextRate);
    } catch (e) {
      console.log('[FullScreenVideo] rate toggle failed', e);
    }
  };

  const handleFullScreenStop = () => {
    const player = getActiveFullScreenPlayer();
    if (!player) return;
    try {
      player.pause();
      player.currentTime = 0;
    } catch (e) {
      console.log('[FullScreenVideo] stop failed', e);
    }
  };

  const seekFullScreenToRatio = (ratio) => {
    const player = fullScreenPlayersByIndex.current.get(currentMediaIndexRef.current) || null;
    if (!player) return;
    const dur = player.duration || fsDurationRef.current || 0;
    if (!dur || dur <= 0) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    const nextTime = clamped * dur;

    try {
      player.currentTime = nextTime;
    } catch (e) {
      try {
        player.seekBy(nextTime - (player.currentTime || 0));
      } catch (e2) {
        console.log('[FullScreenVideo] seek failed', e2);
      }
    }
    fsPositionRef.current = nextTime;
    setFullScreenPosition(nextTime);
  };
  seekFullScreenToRatioRef.current = seekFullScreenToRatio;

  const fullScreenSliderPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (evt) => {
        fsIsSeekingRef.current = true;
        setIsSeekingFullScreen(true);
        
        const player = fullScreenPlayersByIndex.current.get(currentMediaIndexRef.current);
        if (player) {
          try { player.pause(); } catch (e) {}
          setFullScreenIsPlaying(false);
        }

        const x = evt?.nativeEvent?.locationX ?? 0;
        const w = fsSliderWidthRef.current;
        const ratio = w > 0 ? x / w : 0;
        const dur = fsDurationRef.current || fullScreenPlayersByIndex.current.get(currentMediaIndexRef.current)?.duration || 0;
        const nextTime = Math.max(0, Math.min(dur, ratio * dur));
        fsSeekingPosRef.current = nextTime;
        setSeekingPositionFullScreen(nextTime);

        if (player) {
          try { player.currentTime = nextTime; } catch (e) {}
        }
      },
      onPanResponderMove: (evt) => {
        const x = evt?.nativeEvent?.locationX ?? 0;
        const w = fsSliderWidthRef.current;
        const ratio = w > 0 ? x / w : 0;
        const dur = fsDurationRef.current || fullScreenPlayersByIndex.current.get(currentMediaIndexRef.current)?.duration || 0;
        const nextTime = Math.max(0, Math.min(dur, ratio * dur));
        fsSeekingPosRef.current = nextTime;
        setSeekingPositionFullScreen(nextTime);

        const player = fullScreenPlayersByIndex.current.get(currentMediaIndexRef.current);
        if (player) {
          try { player.currentTime = nextTime; } catch (e) {}
        }
      },
      onPanResponderRelease: () => {
        const dur = fsDurationRef.current || fullScreenPlayersByIndex.current.get(currentMediaIndexRef.current)?.duration || 0;
        const nextTime = fsSeekingPosRef.current ?? fsPositionRef.current;
        if (dur > 0) {
          seekFullScreenToRatioRef.current?.((nextTime || 0) / dur);
        }
        fsSeekingPosRef.current = null;
        setIsSeekingFullScreen(false);
        setSeekingPositionFullScreen(null);
        setTimeout(() => { fsIsSeekingRef.current = false; }, 600);
      },
      onPanResponderTerminate: () => {
        fsSeekingPosRef.current = null;
        fsIsSeekingRef.current = false;
        setIsSeekingFullScreen(false);
        setSeekingPositionFullScreen(null);
      },
    })
  ).current;

  useEffect(() => {
    if (fullScreenMedia) {
      StatusBar.setHidden(true, 'fade');
    } else {
      StatusBar.setHidden(false, 'fade');
    }
    return () => {
      StatusBar.setHidden(false, 'fade');
    };
  }, [fullScreenMedia]);

  useEffect(() => {
    if (!fullScreenMedia) {
      cleanupFullScreenPlayerSubscriptions();
      fullScreenPlayersByIndex.current = new Map();
      setShowFullScreenControls(true);
      setFullScreenPosition(0);
      setFullScreenDuration(0);
      setFullScreenIsPlaying(false);
      return;
    }

    setShowFullScreenControls(true);
    const player = fullScreenPlayersByIndex.current.get(currentMediaIndex);
    if (player) attachFullScreenPlayer(player);
  }, [fullScreenMedia, currentMediaIndex]);

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

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(recordingDotOpacity, {
            toValue: 0.3,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(recordingDotOpacity, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      recordingDotOpacity.setValue(1);
    }
  }, [isRecording]);

  useEffect(() => {
    if (recorderStatus.isRecording) {
      setRecordingDuration(recorderStatus.durationMillis);
    } else if (recorderStatus.durationMillis > 0) {
      // Если запись остановилась, сохраняем финальную длительность
      setRecordingDuration(recorderStatus.durationMillis);
    }
    
    // Добавим лог для отладки в реальном времени
    if (recorderStatus.isRecording && recorderStatus.durationMillis % 1000 < 100) {
      console.log('[ChatScreen] Recorder status:', recorderStatus.isRecording, 'duration:', recorderStatus.durationMillis);
    }
  }, [recorderStatus.durationMillis, recorderStatus.isRecording]);


  // Основной механизм: слушаем уведомления из контекста
  const lastProcessedNotificationRef = useRef(null);
  const currentUserIdRef = useRef(currentUserId);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    if (notifications.length > 0) {
      // Находим индекс последнего обработанного уведомления
      const lastIdx = lastProcessedNotificationRef.current 
        ? notifications.findIndex(n => n === lastProcessedNotificationRef.current)
        : -1;
      
      // Выделяем новые уведомления (те, что до последнего обработанного)
      const newNotifications = lastIdx === -1 ? notifications : notifications.slice(0, lastIdx);
      
      // Обрабатываем в хронологическом порядке (с конца массива к началу)
      [...newNotifications].reverse().forEach(lastNotify => {
        const notifyType = lastNotify.type || lastNotify.msg_type;
        
        if (notifyType === 'new_message' && lastNotify.data) {
          const message = lastNotify.data;
          const msgSenderId = Number(message.sender_id);
          const msgReceiverId = Number(message.receiver_id);
          const currentChatId = Number(userId);
          const myIdNum = Number(currentUserIdRef.current || currentUserId);

          console.log('[ChatScreen] Message check - from:', msgSenderId, 'to:', msgReceiverId, 'currentChat:', currentChatId, 'myId:', myIdNum);

          const isRelated = (msgSenderId === currentChatId && msgReceiverId === myIdNum) || 
                            (msgSenderId === myIdNum && msgReceiverId === currentChatId);
          
          if (isRelated) {
            setMessages(prev => {
              // 1. Пытаемся найти по client_id (только если сообщение от нас)
              if (message.client_id && msgSenderId === myIdNum) {
                 const existingIdx = prev.findIndex(m => (m.client_id && m.client_id === message.client_id) || (m.id && String(m.id) === String(message.client_id)));
                 if (existingIdx !== -1) {
                   console.log('[ChatScreen] Found optimistic message to replace by client_id:', message.client_id);
                   const updated = [...prev];
                   // Важно сохранить старый client_id, чтобы не продублировать, если придет вторая нотификация
                   updated[existingIdx] = { 
                     ...message, 
                     client_id: message.client_id || prev[existingIdx].client_id,
                     status: 'sent' 
                   };
                   return updated;
                 }
              }

              // 2. Пытаемся найти по id (сообщение от собеседника или уже обработанное)
              if (prev.find(m => m.id && message.id && String(m.id) === String(message.id))) {
                console.log('[ChatScreen] Message already exists in state, skipping:', message.id);
                return prev;
              }

              return [{ ...message, status: 'sent' }, ...prev];
            });
            setSkip(prev => prev + 1);
            
            if (msgSenderId === currentChatId) {
              // Сообщение от собеседника
              clearUnread(userId);
              const isAppActive = AppState.currentState === 'active';
              if (isAppActive) {
                // playMessageSound(); // Дубликат удален: звук теперь проигрывается только в NotificationContext
                markAsReadWs(userId);
              }
            } else {
              // Сообщение от меня
              console.log('[ChatScreen] My message added to list');
            }
          } else {
            console.log('[ChatScreen] Message not related to this chat, ignoring');
          }
        } else if (notifyType === 'message_deleted') {
          const msgId = lastNotify.message_id || lastNotify.data?.message_id || lastNotify.data?.id;
          const uploadId = lastNotify.upload_id || lastNotify.data?.upload_id;
          if (msgId || uploadId) {
            setMessages(prev => {
              return prev.filter(m => {
                if (msgId && String(m.id) === String(msgId)) return false;
                if (uploadId && m.upload_id === uploadId) return false;
                return true;
              });
            });
            fetchDialogs();
          }
        } else if (notifyType === 'messages_read' || notifyType === 'your_messages_read' || notifyType === 'mark_read') {
          // messages_read приходит нам, когда МЫ прочитали чьи-то сообщения (от Notifications WS)
          // ИЛИ когда КТО-ТО прочитал наши сообщения (от Chat WS)
          // your_messages_read приходит нам, когда КТО-ТО прочитал наши сообщения (от Notifications WS)
          
          const readerId = lastNotify.reader_id || lastNotify.data?.reader_id;
          
          // Если это подтверждение прочтения НАШИХ сообщений кем-то другим
          if (notifyType === 'your_messages_read' || notifyType === 'mark_read' || (notifyType === 'messages_read' && readerId && Number(readerId) === Number(userId))) {
            setMessages(prev => prev.map(m => 
              (m.sender_id && Number(m.sender_id) === Number(currentUserId)) ? { ...m, is_read: true } : m
            ));
          }
        } else if (notifyType === 'user_status' && lastNotify.data) {
          const { user_id, status, last_seen } = lastNotify.data;
          if (Number(user_id) === Number(userId)) {
            setInterlocutor(prev => prev ? { ...prev, status, last_seen } : null);
          }
        }
      });
      
      // Запоминаем последнее уведомление из списка как обработанное
      lastProcessedNotificationRef.current = notifications[0];
    }
  }, [notifications, userId, currentUserId]);

  // Добавляем слушатель состояния приложения, чтобы помечать прочитанным при возврате в активный чат
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active' && userId) {
        console.log('[ChatScreen] App became active while in chat, refreshing history');
        // Помечаем как прочитанные
        markAsReadWs(userId);
        clearUnread(userId);
        // Запрашиваем историю, чтобы гарантированно получить сообщения, пришедшие пока приложение было в фоне
        getHistoryWs(userId, LIMIT, 0);
      }
    });
    return () => {
      subscription.remove();
    };
  }, [markAsReadWs, clearUnread, userId, getHistoryWs]);

  // Перезагружаем историю при восстановлении соединения сокета
  useEffect(() => {
    if (isChatConnected && userId) {
      console.log('[ChatScreen] Chat socket connected, requesting fresh history');
      getHistoryWs(userId, LIMIT, 0);
      markAsReadWs(userId);
      clearUnread(userId);
    }
  }, [isChatConnected, userId, getHistoryWs, markAsReadWs, clearUnread]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    // setActiveChatId(userId); // Дубликат удален
    setMessages([]); // Reset messages on mount
    setHasMore(true);
    setSkip(0);
    return () => {
      // setActiveChatId(null); // Дубликат удален
      // We don't call recorder.stop() here because useAudioRecorder manages its own lifecycle.
      // Calling it manually during unmount can race with the hook's internal cleanup.
    };
  }, [userId]);

  useEffect(() => {
    const unsubscribe = onHistoryReceived((payload) => {
      if (Number(payload.other_user_id) === Number(userId)) {
        setMessages(prev => {
          if (payload.skip === 0) {
            // При получении свежей истории (skip=0) сохраняем отправляемые в данный момент сообщения
            const pending = prev.filter(m => m.status === 'pending');
            // Сохраняем также сообщения, которые пришли через уведомления, пока мы ждали историю
            // Если в полученной истории НЕТ сообщения, которое уже есть в стейте (добавлено через уведомление), 
            // то мы должны его оставить. Но обычно история содержит всё.
            // Проблема в том, что payload.data может быть чуть старее, чем уведомления, которые уже прилетели.
            
            const fromNotifications = prev.filter(m => m.status === 'sent' && !payload.data.find(im => im.id === m.id));
            if (fromNotifications.length > 0) {
              console.log('[ChatScreen] Preserving messages from notifications during history refresh:', fromNotifications.map(m => m.id));
            }

            // Исключаем из pending те, которые уже вернулись от сервера в составе истории
            const actualPending = pending.filter(pm => !payload.data.find(m => (
              m.sender_id && Number(m.sender_id) === Number(currentUserId) && 
              m.client_id && m.client_id === pm.client_id
            )));
            
            const rawResult = [...actualPending, ...fromNotifications, ...payload.data];
            
            // Финальная дедупликация (на случай гонок или дубликатов от сервера)
            // Приоритет отдаем сообщениям из БД (payload.data), при этом среди них
            // предпочитаем завершенные сообщения плейсхолдерам с тем же client_id
            const uniqueMessages = [];
            const seenIds = new Set();
            const seenClientIds = new Map(); // cid -> { index in filteredServerData, is_uploading }

            // 1. Сначала фильтруем саму историю от сервера на случай дублей в базе
            // (особенно плейсхолдеров, которые могли остаться при пакетной загрузке)
            const filteredServerData = [];
            
            payload.data.forEach(m => {
              const mid = (m.id && !String(m.id).startsWith('c_')) ? String(m.id) : null;
              const cid = m.client_id ? String(m.client_id) : null;
              
              if (mid && seenIds.has(mid)) return;
              
              if (cid && seenClientIds.has(cid)) {
                const seen = seenClientIds.get(cid);
                // Если мы уже видели этот client_id, и текущее сообщение (m) более "полноценное"
                // (не в процессе загрузки), а предыдущее было плейсхолдером — заменяем его.
                // История идет от новых к старым, поэтому обычно первое встреченное — актуальнее.
                // Но в случае плейсхолдеров нам важнее статус завершенности.
                if (seen.is_uploading && !m.is_uploading) {
                   filteredServerData[seen.index] = m;
                   seenClientIds.set(cid, { index: seen.index, is_uploading: false });
                   if (mid) seenIds.add(mid);
                }
                return;
              }

              if (mid) seenIds.add(mid);
              if (cid) seenClientIds.set(cid, { index: filteredServerData.length, is_uploading: !!m.is_uploading });
              filteredServerData.push(m);
            });
            
            // Сбрасываем сеты для фильтрации пендингов и нотификаций
            const finalSeenIds = new Set();
            const finalSeenClientIds = new Set();
            filteredServerData.forEach(m => {
              if (m.id && !String(m.id).startsWith('c_')) finalSeenIds.add(String(m.id));
              if (m.client_id) finalSeenClientIds.add(String(m.client_id));
            });
            
            // 3. Добавляем в результат в правильном порядке: сначала пендинги, потом нотификации, потом историю
            // При этом фильтруем пендинги и нотификации, если они уже есть в истории (по id или client_id)
            
            const filteredPending = actualPending.filter(m => {
              const cid = m.client_id ? String(m.client_id) : null;
              const mid = (m.id && !String(m.id).startsWith('c_')) ? String(m.id) : null;
              if (mid && finalSeenIds.has(mid)) return false;
              if (cid && finalSeenClientIds.has(cid)) return false;
              if (mid) finalSeenIds.add(mid);
              if (cid) finalSeenClientIds.add(cid);
              return true;
            });

            const filteredNotifications = fromNotifications.filter(m => {
              const cid = m.client_id ? String(m.client_id) : null;
              const mid = (m.id && !String(m.id).startsWith('c_')) ? String(m.id) : null;
              if (mid && finalSeenIds.has(mid)) return false;
              if (cid && finalSeenClientIds.has(cid)) return false;
              if (mid) finalSeenIds.add(mid);
              if (cid) finalSeenClientIds.add(cid);
              return true;
            });

            uniqueMessages.push(...filteredPending);
            uniqueMessages.push(...filteredNotifications);
            uniqueMessages.push(...filteredServerData);
            
            return uniqueMessages;
          } else {
            // При подгрузке старой истории фильтруем только те, которых еще нет в стейте
            const newMsgs = payload.data.filter((m, idx) => 
              !prev.find(pm => String(pm.id) === String(m.id)) &&
              payload.data.findIndex(im => String(im.id) === String(m.id)) === idx
            );
            return [...prev, ...newMsgs];
          }
        });
        
        if (payload.skip === 0) {
           setSkip(payload.data.length);
        } else {
           setSkip(prev => prev + payload.data.length);
        }

        if (payload.data.length < LIMIT) {
          setHasMore(false);
        }
        setLoadingMore(false);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [userId, onHistoryReceived]);

  useEffect(() => {
    let ignore = false;

    const initChat = async () => {
      const accessToken = await storage.getAccessToken();
      setToken(accessToken);

      // 1. Мгновенная загрузка из кэша для "непрерывного" UI
      const cachedHistory = await getCachedHistory(userId);
      if (cachedHistory && cachedHistory.length > 0) {
        console.log(`[ChatScreen] Loaded ${cachedHistory.length} messages from cache`);
        setMessages(cachedHistory);
        setSkip(cachedHistory.length);
      }

      let myId = currentUser?.id;
      if (!myId) {
        // Загрузка данных текущего пользователя если их нет в контексте
        try {
          const userRes = await usersApi.getMe();
          myId = userRes.data.id;
        } catch (err) {
          console.log('Failed to load current user', err);
        }
      }

      // Загрузка начальной истории через WebSocket
      console.log(`[ChatScreen] Requesting initial history via WS for user: ${userId}`);
      setLoadingMore(true);
      const requested = getHistoryWs(userId, LIMIT, 0);
      if (!requested) {
        // Fallback to API if WS not ready
        try {
          const res = await chatApi.getHistory(userId, accessToken, LIMIT, 0);
          if (!ignore) {
            console.log(`[ChatScreen] Loaded initial history via API fallback: ${res.data.length} messages`);
            setMessages(res.data);
            setSkip(res.data.length);
            if (res.data.length < LIMIT) {
              setHasMore(false);
            }
          }
        } catch (error) {
          console.error('Failed to load history via API', error);
        } finally {
          setLoadingMore(false);
        }
      }

      // Помечаем как прочитанные через WebSocket только если приложение активно и экран в фокусе
      const isAppActive = AppState.currentState === 'active';
      console.log('[ChatScreen] initChat, app state:', AppState.currentState);
      
      if (isAppActive) {
        console.log('[ChatScreen] Initializing chat, app is active, marking as read');
        markAsReadWs(userId);
        clearUnread(userId);
      } else {
        console.log('[ChatScreen] Initializing chat, app is in background, NOT marking as read');
      }

      // Загрузка данных собеседника - сначала из диалогов
      const existingDlg = dialogs.find(d => Number(d.user_id) === Number(userId));
      if (existingDlg) {
        setInterlocutor(existingDlg);
      } else {
        usersApi.getUser(userId).then(res => {
          if (!ignore) setInterlocutor(res.data);
        }).catch(err => console.log(err));
      }

      if (!myId) {
        console.error('[ChatScreen] Cannot initialize chat: myId is null');
        return;
      }

      if (ignore) return;

      // Проверка активных загрузок
      uploadManager.getActiveUploadsForReceiver(userId).then(activeUploads => {
        if (activeUploads.length > 0) {
          const mainUpload = activeUploads[0];
          setActiveUploadId(mainUpload.upload_id);
          setUploadingProgress(mainUpload.currentOffset / mainUpload.fileSize);
          setUploadingData({ 
            loaded: mainUpload.currentOffset, 
            total: mainUpload.fileSize,
            uri: mainUpload.fileUri,
            mimeType: mainUpload.mimeType
          });
        }
      }).catch(err => console.log('[ChatScreen] Failed to check active uploads', err));
    };

    initChat();

    return () => {
      ignore = true;
    };
  }, [userId]);

  const loadMoreMessages = async () => {
    if (loadingMore || !hasMore || !token) return;

    setLoadingMore(true);
    console.log(`[ChatScreen] Requesting more history via WS. Skip: ${skip}`);
    const requested = getHistoryWs(userId, LIMIT, skip);
    if (!requested) {
      // Fallback to API
      try {
        const res = await chatApi.getHistory(userId, token, LIMIT, skip);
        console.log(`[ChatScreen] Loaded ${res.data.length} more messages via API. Skip was ${skip}`);
        if (res.data.length > 0) {
          setMessages(prev => {
             const newMsgs = res.data.filter(m => !prev.find(pm => String(pm.id) === String(m.id)));
             return [...prev, ...newMsgs];
          });
          setSkip(prev => prev + res.data.length);
        }
        if (res.data.length < LIMIT) {
          setHasMore(false);
        }
      } catch (error) {
        console.error('Failed to load more messages via API', error);
      } finally {
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    // Собираем все медиафайлы из сообщений для полноэкранного просмотра
    const media = [];
    // Сообщения в messages идут от новых к старым (inverted FlatList).
    // Пользователь хочет, чтобы скролл вправо (увеличение индекса в allMedia)
    // вел к БОЛЕЕ ПОЗДНИМ (новым) видео.
    // Значит allMedia должен быть от СТАРЫХ к НОВЫМ.
    // Для этого итерируем messages с конца.
    
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.message_type === 'media_group' && msg.attachments) {
        msg.attachments.forEach(att => {
          if (att.file_path && att.type !== 'video_note') {
            media.push({
              uri: att.file_path.startsWith('http') ? att.file_path : `${API_BASE_URL}${att.file_path}`,
              file_path: att.file_path,
              type: att.type,
              messageId: msg.id
            });
          }
        });
      } else if ((msg.message_type === 'image' || msg.message_type === 'video') && msg.file_path && msg.message_type !== 'video_note') {
        media.push({
          uri: msg.file_path.startsWith('http') ? msg.file_path : `${API_BASE_URL}${msg.file_path}`,
          file_path: msg.file_path,
          type: msg.message_type,
          messageId: msg.id
        });
      }
    }
    setAllMedia(media);
  }, [messages]);

  const openFullScreen = (uri, type) => {
    // Для видео/фото из кэша uri может быть локальным путем (file://...)
    // Нам нужно сопоставить его с элементом в allMedia
    const index = allMedia.findIndex(m => {
      if (m.uri === uri) return true;
      // Проверяем по имени файла, если uri локальный
      const fileName = uri.split('/').pop();
      const mFileName = m.uri.split('/').pop();
      return fileName && mFileName && fileName === mFileName;
    });
    
    if (index !== -1) {
      setCurrentMediaIndex(index);
      currentMediaIndexRef.current = index;
      setFullScreenMedia({ index, list: allMedia });
      
      // Синхронизируем чат при открытии
      const mediaItem = allMedia[index];
      if (mediaItem && mediaItem.messageId) {
        const msgIndex = messages.findIndex(m => m.id === mediaItem.messageId);
        if (msgIndex !== -1) {
          setTimeout(() => {
            chatFlatListRef.current?.scrollToIndex({ index: msgIndex, animated: true, viewPosition: 0.5 });
          }, 100);
        }
      }
    } else {
      // Fallback если вдруг не нашли в общем списке
      setCurrentMediaIndex(0);
      currentMediaIndexRef.current = 0;
      setFullScreenMedia({ index: 0, list: [{ uri, type: type || 'image', file_path: uri }] });
    }
  };

  const handleDownloadMedia = async () => {
    const currentMedia = fullScreenMedia?.list[currentMediaIndex];
    if (!currentMedia) return;

    if (Platform.OS === 'web') {
      try {
        const uri = currentMedia.uri;
        const fileName = uri.split('/').pop();
        const link = document.createElement('a');
        link.href = uri;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (e) {
        window.open(currentMedia.uri, '_blank');
      }
      return;
    }

    try {
      const uri = currentMedia.uri;
      const fileName = uri.split('/').pop();
      const localFileUri = `${documentDirectory}${fileName}`;

      const fileInfo = await getInfoAsync(localFileUri);
      let finalUri = localFileUri;

      if (!fileInfo.exists) {
        Alert.alert('Загрузка', 'Файл скачивается...');
        const downloadRes = await downloadAsync(uri, localFileUri);
        finalUri = downloadRes.uri;
      }

      if (Platform.OS === 'android') {
        const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const base64 = await readAsStringAsync(finalUri, { encoding: EncodingType.Base64 });
          const mimeType = currentMedia.type === 'video' ? 'video/mp4' : 'image/jpeg';
          const newFileUri = await StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            fileName,
            mimeType
          );
          await writeAsStringAsync(newFileUri, base64, { encoding: EncodingType.Base64 });
          Alert.alert('Успех', 'Медиа-файл сохранен');
        }
      } else {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(finalUri);
        } else {
          Alert.alert('Ошибка', 'Функция "Поделиться" недоступна на этом устройстве');
        }
      }
    } catch (error) {
      console.error('Error downloading media:', error);
      Alert.alert('Ошибка', 'Не удалось скачать файл');
    }
  };

  const sendMessage = async () => {
    if (selectionMode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (inputText.trim()) {
      const clientId = `c_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const msgData = {
        receiver_id: userId,
        message: inputText.trim(),
        message_type: 'text',
        client_id: clientId,
        reply_to_id: replyingToMessage ? replyingToMessage.id : null
      };
      
      // Оптимистичное добавление в UI
      const optimisticMsg = {
        ...msgData,
        id: clientId, // используем clientId как временный id для FlatList key
        sender_id: currentUserId,
        timestamp: new Date().toISOString(),
        is_read: false,
        status: 'pending', // Статус для визуализации
        reply_to: replyingToMessage
      };
      
      setMessages(prev => [optimisticMsg, ...prev]);
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

  useEffect(() => {
    if (activeUploadId) {
      const unsubscribe = uploadManager.subscribe(activeUploadId, ({ progress, status, result, loaded, total }) => {
        setUploadingProgress(progress);
        if (loaded !== undefined) setUploadingData(prev => ({ ...prev, loaded, total }));
        
        if (status === 'completed') {
          // Для одиночных голосовых сообщений отправляем здесь
          // Для медиа и документов теперь отправляем вручную в функциях загрузки
          if (autoSendOnUpload && !batchMode && !isVideoNoteUploadRef.current) { 
            const clientId = `c_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const msgData = {
              receiver_id: userId,
              file_path: result.file_path,
              message_type: result.message_type,
              client_id: clientId,
              reply_to_id: replyingToMessage ? replyingToMessage.id : null
            };
            
            // Оптимистичное добавление
            const optimisticMsg = {
              ...msgData,
              id: clientId,
              sender_id: currentUserId,
              timestamp: new Date().toISOString(),
              is_read: false,
              status: 'pending',
              reply_to: replyingToMessage
            };
            setMessages(prev => [optimisticMsg, ...prev]);
            setReplyingToMessage(null);

            sendMessageWs(msgData);
          } 
          setUploadingProgress(null);
          setActiveUploadId(null);
          setUploadingData({ loaded: 0, total: 0, uri: null, mimeType: null });
        } else if (status === 'error') {
          setUploadingProgress(null);
          setActiveUploadId(null);
          setUploadingData({ loaded: 0, total: 0, uri: null, mimeType: null });
          Alert.alert('Ошибка', 'Не удалось завершить загрузку файла');
        } else if (status === 'cancelled') {
          setUploadingProgress(null);
          setActiveUploadId(null);
          setUploadingData({ loaded: 0, total: 0, uri: null, mimeType: null });
        }
      });
      return () => unsubscribe();
    }
  }, [activeUploadId, userId, autoSendOnUpload, replyingToMessage]);

  const pickAndUploadDocument = async () => {
    if (selectionMode) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true
      });

      if (!result.canceled) {
        const assets = result.assets || [];
        setBatchMode(true);
        setAutoSendOnUpload(false);
        setBatchTotal(assets.length);
        setAttachmentsLocalCount(0);
        const attachmentsLocal = [];
        const clientId = `c_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        for (const asset of assets) {
          setUploadingData({ 
            loaded: 0, 
            total: asset.size || 0, 
            uri: asset.uri, 
            mimeType: asset.mimeType 
          });
          setUploadingProgress(0);
          
          try {
            const res = await uploadManager.uploadFileResumable(
              asset.uri,
              asset.name,
              asset.mimeType,
              userId,
              (uid) => { 
                setActiveUploadId(uid);
                try {
                  const mt = (asset?.mimeType || '').startsWith('image/') ? 'image' : ((asset?.mimeType || '').startsWith('video/') ? 'video' : ((asset?.mimeType || '').startsWith('audio/') ? 'voice' : 'file'));
                  sendMessageWs({ type: 'upload_started', receiver_id: userId, message_type: mt, upload_id: uid, client_id: clientId });
                } catch (e) { console.warn('Failed to send upload_started WS', e); }
              }
            );

            if (res && res.status === 'completed') {
               setAttachmentsLocalCount(prev => prev + 1);
               attachmentsLocal.push({ file_path: res.file_path, type: res.message_type });
            }
          } catch (err) {
            console.error('Failed to upload asset in batch', asset.name, err);
          }
        }

        if (attachmentsLocal.length > 0) {
          const msgData = attachmentsLocal.length === 1 
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

          // Оптимистичное добавление
          const optimisticMsg = {
            ...msgData,
            id: clientId,
            sender_id: currentUserId,
            timestamp: new Date().toISOString(),
            is_read: false,
            status: 'pending'
          };
          setMessages(prev => [optimisticMsg, ...prev]);

          sendMessageWs(msgData);
        }
      }
    } catch (error) {
      console.error('Document picking failed', error);
      Alert.alert('Ошибка', 'Произошла ошибка при выборе или загрузке документа');
    } finally {
      setBatchMode(false);
      setAutoSendOnUpload(true);
      setUploadingProgress(null);
      setActiveUploadId(null);
      setBatchTotal(0);
      setAttachmentsLocalCount(0);
    }
  };

  const pickAndUploadFile = async () => {
    if (selectionMode) return;
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

        setBatchMode(true);
        setAutoSendOnUpload(false);
        setBatchTotal(assets.length);
        setAttachmentsLocalCount(0);
        const attachmentsLocal = [];
        const clientId = `c_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        for (const asset of assets) {
          const fileName = asset.uri.split('/').pop();
          setUploadingData({ 
            loaded: 0, 
            total: asset.fileSize || asset.size || 0, 
            uri: asset.uri, 
            mimeType: asset.mimeType 
          });
          setUploadingProgress(0);
          
          try {
            const res = await uploadManager.uploadFileResumable(
              asset.uri, 
              fileName, 
              asset.mimeType,
              userId,
              (upload_id) => { setActiveUploadId(upload_id); try { const mt = (asset?.mimeType || '').startsWith('image/') ? 'image' : ((asset?.mimeType || '').startsWith('video/') ? 'video' : ((asset?.mimeType || '').startsWith('audio/') ? 'voice' : 'file')); sendMessageWs({ type: 'upload_started', receiver_id: userId, message_type: mt, upload_id: upload_id, client_id: clientId }); } catch (e) { console.warn('Failed to send upload_started WS', e); } }
            );
            
            if (res && res.status === 'completed') {
              setAttachmentsLocalCount(prev => prev + 1);
              attachmentsLocal.push({ file_path: res.file_path, type: res.message_type });
            }
          } catch (err) {
            console.error('Failed to upload image/video in batch', fileName, err);
          }
        }

        if (attachmentsLocal.length > 0) {
          const msgData = attachmentsLocal.length === 1 
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

          // Оптимистичное добавление
          const optimisticMsg = {
            ...msgData,
            id: clientId,
            sender_id: currentUserId,
            timestamp: new Date().toISOString(),
            is_read: false,
            status: 'pending'
          };
          setMessages(prev => [optimisticMsg, ...prev]);

          sendMessageWs(msgData);
        }
      }
    } catch (error) {
      console.error('Upload or picking failed', error);
      Alert.alert('Ошибка', 'Произошла ошибка при выборе или загрузке файла');
    } finally {
      setBatchMode(false);
      setAutoSendOnUpload(true);
      setBatchAttachments([]);
      setBatchTotal(0);
      setAttachmentsLocalCount(0);
      setUploadingProgress(null);
      setActiveUploadId(null);
    }
  };


  const handleSendVideoNote = async (uri) => {
    if (!uri) return;
    isVideoNoteUploadRef.current = true;
    try {
      const filename = `video_note_${Date.now()}.mp4`;
      let currentUploadId = null;

      // Устанавливаем данные для плейсхолдера
      setUploadingData({
        uri: uri,
        mimeType: 'video/mp4',
        type: 'video_note',
        loaded: 0,
        total: 100
      });

      const clientId = `c_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const uploadResult = await uploadManager.uploadFileResumable(
        uri,
        filename,
        'video/mp4',
        userId,
        (id) => {
          currentUploadId = id;
          setActiveUploadId(id);
          try { sendMessageWs({ type: 'upload_started', receiver_id: userId, message_type: 'video', upload_id: id, client_id: clientId }); } catch (e) { console.warn('Failed to send upload_started WS', e); }
          uploadManager.subscribe(id, ({ progress, status, loaded, total }) => {
            if (status === 'uploading' || status === 'completed') {
              setUploadingProgress(progress);
              if (loaded !== undefined) setUploadingData(prev => ({ ...prev, loaded, total }));
            } else if (status === 'error' || status === 'cancelled') {
              setUploadingProgress(null);
              setActiveUploadId(null);
            }
          });
        }
      );

      if (uploadResult && (uploadResult.file_path || uploadResult.result?.file_path)) {
        const filePath = uploadResult.file_path || uploadResult.result?.file_path;
        sendMessageWs({
          receiver_id: userId,
          message: null,
          file_path: filePath,
          message_type: 'video_note'
        });
      }
    } catch (err) {
      console.error('[ChatScreen] handleSendVideoNote error:', err);
      Alert.alert('Ошибка', 'Не удалось отправить видеосообщение');
    } finally {
      isVideoNoteUploadRef.current = false;
      setUploadingProgress(null);
      setActiveUploadId(null);
    }
  };

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const startVideoRecording = async () => {
    try {
      // Использование хука для получения разрешений
      let cameraStatus = cameraPermission?.status;
      if (cameraStatus !== 'granted') {
        const res = await requestCameraPermission();
        cameraStatus = res?.status;
      }
      const { status: audioStatus } = await requestRecordingPermissionsAsync();
      
      if (cameraStatus !== 'granted' || audioStatus !== 'granted') {
        Alert.alert('Доступ запрещен', 'Нам нужны разрешения на камеру и микрофон для записи видеосообщений.');
        return;
      }

      setIsVideoRecording(true);
      setRecordingDuration(0);
      const startTime = Date.now();
      
      // Начинаем запись чуть позже, чтобы камера успела инициализироваться
      setTimeout(async () => {
        if (cameraRef.current) {
          try {
            console.log('[ChatScreen] startVideoRecording - starting recordAsync');
            const videoPromise = cameraRef.current.recordAsync({
              maxDuration: 60,
              quality: '720p',
            });
            
            const video = await videoPromise;
            const duration = Date.now() - startTime;
            console.log('[ChatScreen] recordAsync finished. URI:', video?.uri, 'Duration:', duration);
            
            if (video && video.uri) {
              if (duration >= 500) {
                setPendingVideoNoteUri(video.uri);
              } else {
                console.log('[ChatScreen] Video note too short, discarding...');
              }
            } else {
              console.error('[ChatScreen] recordAsync finished but URI is missing');
            }
          } catch (error) {
            console.error('Video recording error:', error);
          } finally {
            setIsVideoRecording(false);
          }
        }
      }, 500);
      
    } catch (error) {
      console.error('Start video recording error:', error);
      setIsVideoRecording(false);
    }
  };

  const stopVideoRecording = async () => {
    console.log('[ChatScreen] stopVideoRecording called, isVideoRecording:', isVideoRecording);
    if (cameraRef.current && isVideoRecording) {
      try {
        console.log('[ChatScreen] stopVideoRecording - calling stopRecording()');
        cameraRef.current.stopRecording();
      } catch (e) {
        console.error('Error stopping video recording:', e);
      }
      // Не ставим setIsVideoRecording(false) здесь, дождемся завершения recordAsync
    } else if (!isVideoRecording) {
      console.warn('[ChatScreen] stopVideoRecording called but isVideoRecording is false');
    }
  };

  const startRecording = async () => {
    if (isStartingRecording.current) return;

    try {
      isStartingRecording.current = true;
      stopRequested.current = false;

      console.log('[ChatScreen] startRecording - permissions...');
      const permission = await requestRecordingPermissionsAsync();
      if (!isMounted.current) return;

      if (permission.status === 'granted') {
        if (stopRequested.current) {
          isStartingRecording.current = false;
          return;
        }

        console.log('[ChatScreen] startRecording - setting audio mode...');
        await setRecordingAudioMode();
        if (!isMounted.current) return;

        if (stopRequested.current) {
          isStartingRecording.current = false;
          return;
        }

        if (recorder) {
          // Prepare recorder explicitly as per expo-audio API
          try {
            await recorder.prepareToRecordAsync(recordingOptions);
          } catch (prepErr) {
            console.error('[ChatScreen] startRecording - prepareToRecordAsync failed:', prepErr);
            throw prepErr;
          }

          // Wait a bit for canRecord to become true after audio mode change
          let canRecordAttempts = 0;
          let canRecord = false;
          while (canRecordAttempts < 10) {
            const s = recorder.getStatus();
            canRecord = !!s?.canRecord;
            if (canRecord) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
            canRecordAttempts++;
          }

          const s0 = recorder.getStatus();
          console.log('[ChatScreen] startRecording - recorder status before record:', {
            isRecording: s0?.isRecording,
            canRecord: s0?.canRecord,
            durationMillis: s0?.durationMillis,
            url: s0?.url,
            uri: recorder.uri,
            canRecordAttempts,
          });

          if (!canRecord) {
            console.warn('[ChatScreen] startRecording - canRecord is still false, attempting record anyway');
          }

          console.log('[ChatScreen] startRecording - calling recorder.record()');

          setRecordedUri(null);
          setRecordingDuration(0);

          try {
            recorder.record();
            console.log('[ChatScreen] startRecording - record() invoked');
          } catch (recordErr) {
            console.error('[ChatScreen] startRecording - record() call failed:', recordErr);
            throw recordErr;
          }

          // Wait for isRecording to flip true
          let attempts = 0;
          let isRec = false;
          while (attempts < 20) {
            const s = recorder.getStatus();
            if (s?.isRecording) {
              isRec = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
            attempts++;
          }

          setIsRecording(isRec);
          console.log('[ChatScreen] startRecording - sync complete. isRecording:', isRec, 'attempts:', attempts);

          if (stopRequested.current) {
            console.log('[ChatScreen] startRecording - stop requested during sync');
            if (isRec) await recorder.stop();
            setIsRecording(false);
          }
        }
      } else {
        Alert.alert('Permission Denied', 'Microphone permission is required');
      }
    } catch (err) {
      console.error('[ChatScreen] startRecording error:', err);
      setIsRecording(false);
    } finally {
      isStartingRecording.current = false;
    }
  };

  const stopRecording = async () => {
    // Mark that stop is requested
    stopRequested.current = true;

    // Immediately update UI to release the button
    const wasRecording = isRecording;
    setIsRecording(false);

    try {
      if (recorder) {
        // Capture status before stopping
        let before = recorder.getStatus();
        const durationAtStop = before?.durationMillis || 0;

        console.log('[ChatScreen] stopRecording - status before stop:', before?.isRecording, 'duration:', durationAtStop, 'wasRecording:', wasRecording);

        // Even if status is false, if it WAS recording visually, give it a moment
        if (!before?.isRecording && wasRecording) {
          console.log('[ChatScreen] stopRecording - waiting for status sync...');
          await new Promise((resolve) => setTimeout(resolve, 200));
          before = recorder.getStatus();
        }

        if (before?.isRecording) {
          await recorder.stop();
        }

        // Wait a bit for Android to finish writing the file
        await new Promise((resolve) => setTimeout(resolve, 400));

        const after = recorder.getStatus();
        const uri = recorder.uri || null;
        const finalDuration = after?.durationMillis || durationAtStop;

        console.log('[ChatScreen] Stop completed. URI:', uri, 'Final Duration:', finalDuration);

        if (uri && finalDuration >= 500) {
          setRecordingDuration(finalDuration);
          setRecordedUri(uri);
        } else if (uri && finalDuration < 500) {
          console.log('[ChatScreen] Recording too short, deleting...');
          setRecordedUri(null);
        } else {
          console.warn('[ChatScreen] Stop finished but URI is missing. Retrying twice...');
          // Attempt 1
          await new Promise((resolve) => setTimeout(resolve, 400));
          let retryUri = recorder.uri || null;
          
          if (!retryUri) {
            // Attempt 2
            console.log('[ChatScreen] Still no URI, final attempt...');
            await new Promise((resolve) => setTimeout(resolve, 600));
            retryUri = recorder.uri || null;
          }

          if (retryUri) {
            console.log('[ChatScreen] URI found on retry:', retryUri);
            setRecordingDuration(finalDuration || 1000);
            setRecordedUri(retryUri);
          } else {
            console.error('[ChatScreen] Failed to get URI after retries');
          }
        }
      }
    } catch (err) {
      console.error('[ChatScreen] stopRecording error:', err);
    }
  };

  const deleteRecording = async () => {
    if (recordedUri) {
      try {
        await deleteAsync(recordedUri, { idempotent: true });
      } catch (e) {
        console.error('Failed to delete recording file', e);
      }
    }
    setRecordedUri(null);
    setRecordingDuration(0);
  };

  const [videoNotePosition, setVideoNotePosition] = useState(0);
  const [videoNoteDuration, setVideoNoteDuration] = useState(0);
  const [videoNoteIsPlaying, setVideoNoteIsPlaying] = useState(false);
  const videoNotePlayerRef = useRef(null);
  const [videoNoteSliderWidth, setVideoNoteSliderWidth] = useState(320);
  const [isVideoNoteSeeking, setIsVideoNoteSeeking] = useState(false);
  const [videoNoteSeekingPosition, setVideoNoteSeekingPosition] = useState(null);
  const videoNoteSubscriptions = useRef([]);
  const [isVideoRecordingTimer, setIsVideoRecordingTimer] = useState(0);
  const videoRecordingInterval = useRef(null);

  useEffect(() => {
    let interval;
    if (isVideoRecording) {
      setIsVideoRecordingTimer(0);
      interval = setInterval(() => {
        setIsVideoRecordingTimer(prev => prev + 1);
      }, 1000);
      videoRecordingInterval.current = interval;
    } else {
      if (videoRecordingInterval.current) {
        clearInterval(videoRecordingInterval.current);
        videoRecordingInterval.current = null;
      }
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isVideoRecording]);

  const cleanupVideoNoteSubscriptions = () => {
    videoNoteSubscriptions.current.forEach(sub => {
      if (sub && typeof sub.remove === 'function') sub.remove();
    });
    videoNoteSubscriptions.current = [];
  };

  const handleVideoNotePlayerReady = (player) => {
    videoNotePlayerRef.current = player;
    cleanupVideoNoteSubscriptions();
    
    if (player) {
      try {
        player.timeUpdateEventInterval = 0.1;
      } catch (e) {}

      setVideoNotePosition(player.currentTime || 0);
      setVideoNoteDuration(player.duration || 0);
      setVideoNoteIsPlaying(!!player.playing);

      const subs = [];
      if (typeof player.addListener === 'function') {
        subs.push(player.addListener('timeUpdate', (payload) => {
          if (isVideoNoteSeeking) return;
          setVideoNotePosition(payload?.currentTime ?? player.currentTime ?? 0);
        }));
        subs.push(player.addListener('sourceLoad', (payload) => {
          setVideoNoteDuration(payload?.duration ?? player.duration ?? 0);
        }));
        subs.push(player.addListener('playingChange', (payload) => {
          setVideoNoteIsPlaying(!!payload?.isPlaying);
        }));
        subs.push(player.addListener('playToEnd', () => {
          setVideoNoteIsPlaying(false);
          try { player.currentTime = 0; } catch (e) {}
        }));
      }
      videoNoteSubscriptions.current = subs;
    }
  };

  const videoNotePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        setIsVideoNoteSeeking(true);
        if (videoNotePlayerRef.current) {
          try { videoNotePlayerRef.current.pause(); } catch (e) {}
          setVideoNoteIsPlaying(false);
        }
        handleVideoNoteSeek(evt);
      },
      onPanResponderMove: (evt, gestureState) => {
        handleVideoNoteSeek(evt);
      },
      onPanResponderRelease: () => {
        setIsVideoNoteSeeking(false);
        if (videoNotePlayerRef.current && videoNoteSeekingPosition !== null) {
          videoNotePlayerRef.current.currentTime = videoNoteSeekingPosition;
          setVideoNotePosition(videoNoteSeekingPosition);
          setVideoNoteSeekingPosition(null);
        }
      },
    })
  ).current;

  const handleVideoNoteSeek = (evt) => {
    const { locationX } = evt.nativeEvent;
    const ratio = Math.max(0, Math.min(1, locationX / videoNoteSliderWidth));
    if (videoNoteDuration > 0) {
      const nextTime = ratio * videoNoteDuration;
      setVideoNoteSeekingPosition(nextTime);
      if (videoNotePlayerRef.current) {
        try { videoNotePlayerRef.current.currentTime = nextTime; } catch (e) {}
      }
    }
  };

  const handleVideoNoteModalClose = () => {
    if (videoNotePlayerRef.current) {
      videoNotePlayerRef.current.pause();
    }
    cleanupVideoNoteSubscriptions();
    setIsVideoNoteModalVisible(false);
    setActiveVideoNote(null);
  };

  const handleVideoNoteTogglePlay = () => {
    if (videoNotePlayerRef.current) {
      if (videoNoteIsPlaying) {
        videoNotePlayerRef.current.pause();
      } else {
        videoNotePlayerRef.current.play();
      }
    }
  };

  const formatRecordingTime = (millis) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const uploadVoiceMessage = async (uri) => {
    if (!uri) return;
    try {
      const fileName = `voice_${Date.now()}.m4a`;
      const mimeType = 'audio/m4a';
      setUploadingData({ loaded: 0, total: 0, uri: uri, mimeType: mimeType });
      
      const clientId = `c_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      await uploadManager.uploadFileResumable(
        uri, 
        fileName, 
        mimeType,
        userId,
        (upload_id) => { setActiveUploadId(upload_id); try { sendMessageWs({ type: 'upload_started', receiver_id: userId, message_type: 'voice', upload_id: upload_id, client_id: clientId }); } catch (e) { console.warn('Failed to send upload_started WS', e); } }
      );
      setRecordedUri(null);
      setRecordingDuration(0);
    } catch (error) {
      console.error('Voice upload failed', error);
      Alert.alert('Ошибка', 'Не удалось загрузить голосовое сообщение');
    } finally {
      setUploadingProgress(null);
    }
  };

  const renderUploadPlaceholder = () => {
    if (uploadingProgress === null || !uploadingData.uri) return null;

    const progressPercent = Math.round(uploadingProgress * 100);

    // Video note — renders like VideoNoteMessage inline (no messageBubble wrapper)
    if (uploadingData.type === 'video_note') {
      return (
        <View style={[styles.messageWrapper, styles.sentWrapper, { opacity: 0.85, marginBottom: 10 }]}>
          <View style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
          <View style={{ position: 'relative', width: 170, height: 170 }}>
            {/* Circle matching VideoNoteMessage inline style */}
            <View style={{
              width: 170,
              height: 170,
              borderRadius: 85,
              overflow: 'hidden',
              backgroundColor: '#1a1a1a',
              justifyContent: 'center',
              alignItems: 'center',
            }}>
              {uploadingData.uri && (
                <Image 
                  source={{ uri: uploadingData.uri }} 
                  style={StyleSheet.absoluteFill} 
                  resizeMode="cover"
                />
              )}
              <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#4FC3F7" />
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13, marginTop: 8 }}>
                  {progressPercent}%
                </Text>
              </View>
            </View>
            {/* Cancel button */}
            <TouchableOpacity
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: 'rgba(0,0,0,0.6)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.3)',
                justifyContent: 'center',
                alignItems: 'center',
              }}
              onPress={() => handleCancelUpload(activeUploadId)}
            >
              <MaterialIcons name="close" size={17} color="#fff" />
            </TouchableOpacity>
          </View>
          <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, alignSelf: 'flex-end', marginTop: 3 }}>
            Отправка...
          </Text>
          </View>
        </View>
      );
    }

    // Other types (image, file, voice…) — keep original messageBubble layout
    return (
      <View style={[
        styles.messageWrapper,
        styles.sentWrapper,
        { opacity: 0.8, marginBottom: 10 }
      ]}>
        <View style={[styles.messageBubble, styles.sent, { backgroundColor: colors.primary }]}>
          {uploadingData.mimeType?.startsWith('image/') ? (
            <View>
              <Image
                source={{ uri: uploadingData.uri }}
                style={{ width: 200, height: 150, borderRadius: 10 }}
                resizeMode="cover"
              />
              <View style={{
                ...StyleSheet.absoluteFillObject,
                backgroundColor: 'rgba(0,0,0,0.3)',
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: 10
              }}>
                <View style={{
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 15,
                  flexDirection: 'row',
                  alignItems: 'center'
                }}>
                  <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>
                    {uploadingData.loaded !== undefined && uploadingData.total !== undefined && uploadingData.total > 0
                      ? `${formatFileSize(uploadingData.loaded)} / ${formatFileSize(uploadingData.total)}` 
                      : `${progressPercent}%`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.3)',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                  onPress={() => handleCancelUpload(activeUploadId)}
                >
                  <MaterialIcons name="close" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          ) : uploadingData.mimeType?.startsWith('video/') ? (
            <VideoUploadPlaceholder
              progressPercent={progressPercent}
              activeUploadId={activeUploadId}
              uri={uploadingData.uri}
              loaded={uploadingData.loaded}
              total={uploadingData.total}
              onCancel={handleCancelUpload}
            />
          ) : (
            <View style={{ padding: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <MaterialIcons 
                  name={uploadingData.mimeType?.startsWith('audio/') ? "mic" : "insert-drive-file"} 
                  size={24} 
                  color="#fff" 
                />
                <Text style={{ color: '#fff', marginLeft: 10, fontWeight: '500', flex: 1 }}>
                  {progressPercent >= 100 ? "Обработка..." : (uploadingData.mimeType?.startsWith('audio/') || uploadingData.mimeType?.startsWith('image/') || uploadingData.mimeType?.startsWith('video/') ? "" : "Загрузка файла...")}
                </Text>
                <TouchableOpacity
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    backgroundColor: 'rgba(0,0,0,0.4)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.3)',
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginLeft: 8,
                  }}
                  onPress={() => handleCancelUpload(activeUploadId)}
                >
                  <MaterialIcons name="close" size={15} color="#fff" />
                </TouchableOpacity>
              </View>
              <View style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2, overflow: 'hidden', width: 150 }}>
                <View style={{ height: '100%', backgroundColor: '#fff', width: `${progressPercent}%` }} />
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10, marginTop: 4, textAlign: 'right' }}>
                {uploadingData.loaded !== undefined && uploadingData.total !== undefined && uploadingData.total > 0
                  ? `${formatFileSize(uploadingData.loaded)} / ${formatFileSize(uploadingData.total)}` 
                  : `${progressPercent}%`}
              </Text>
            </View>
          )}
          <View style={styles.messageFooter}>
            <Text style={[styles.messageTime, { color: 'rgba(255,255,255,0.9)' }]}>Отправка...</Text>
          </View>
        </View>
      </View>
    );
  };


  const renderMessageText = (message, isReceived) => {
    if (!searchQuery || !isSearching || !message) {
      return (
        <Text style={[
          styles.messageText,
          isReceived ? { color: colors.text } : { color: '#fff' }
        ]}>
          {message}
        </Text>
      );
    }

    const parts = message.split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return (
      <Text style={[
        styles.messageText,
        isReceived ? { color: colors.text } : { color: '#fff' }
      ]}>
        {parts.map((part, i) => (
          part.toLowerCase() === searchQuery.toLowerCase() ? (
            <Text key={i} style={{ backgroundColor: 'rgba(255, 255, 0, 0.4)', fontWeight: 'bold' }}>{part}</Text>
          ) : (
            <Text key={i}>{part}</Text>
          )
        ))}
      </Text>
    );
  };

  const renderMessageItem = ({ item, index }) => {
    const isImage = item.message_type === 'image';
    const isVideo = item.message_type === 'video';
    const isVoice = item.message_type === 'voice';
    const isVideoNote = item.message_type === 'video_note';
    const isFile = item.message_type === 'file';
    const isReceived = Number(item.sender_id) === Number(userId);
    const isOwner = Number(item.sender_id) === Number(currentUserId);
    const isSelected = selectedIds.includes(item.id);

    // Входящий (и исходящий) плейсхолдер загрузки для собеседника
    if (item?.is_uploading && !item?.file_path) {
      // Скрываем дубликат плейсхолдера для отправителя, если у него есть локальный индикатор
      if (!isReceived && uploadingProgress !== null) return null;

      const progressPercent = Math.round(((item.upload_progress || 0) * 100));
      const progressText = (item.upload_offset !== undefined && item.upload_total !== undefined && item.upload_total > 0)
        ? `${formatFileSize(item.upload_offset)} / ${formatFileSize(item.upload_total)}`
        : (progressPercent > 0 ? `${progressPercent}%` : '');

      const isMediaGroup = item.message_type === 'media_group';
      const isMedia = isImage || isVideo || isVoice || isVideoNote || isMediaGroup;

      return (
        <View style={[styles.messageWrapper, isReceived ? styles.receivedWrapper : styles.sentWrapper]}>
          <View style={[styles.messageBubble, isReceived ? styles.receivedBubble : styles.sentBubble]}> 
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator size="small" color={isReceived ? colors.text : '#fff'} />
              <Text style={[styles.messageText, isReceived ? { color: colors.text } : { color: '#fff' }, { marginLeft: 8 }]}>
                {progressPercent >= 100 ? "Обработка..." : (!isReceived && isMedia ? "" : "Загрузка файла... ")}
                {progressPercent < 100 ? progressText : ""}
              </Text>
            </View>
          </View>
        </View>
      );
    }

    // Группировка: если предыдущее сообщение от того же отправителя и разница во времени менее 2 минут
    const prevMsg = messages[index + 1]; // Помним, что FlatList inverted
    
    const currentMsgDate = parseISODate(item.timestamp);
    const prevMsgDate = prevMsg ? parseISODate(prevMsg.timestamp) : null;
    
    const isGrouped = prevMsg && Number(prevMsg.sender_id) === Number(item.sender_id) && 
                      currentMsgDate && prevMsgDate && (currentMsgDate - prevMsgDate) < 120000;

    const handleFullScreen = (uri, type) => {
      if (selectionMode) {
        toggleSelection(item.id);
        return;
      }
      openFullScreen(uri, type);
    };

    const toggleSelection = (id) => {
      setSelectedIds(prev => 
        prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
      );
    };

    const handleLongPress = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (!selectionMode) {
        setSelectionMode(true);
        setSelectedIds([item.id]);
      }
    };

    const handlePress = () => {
      if (selectionMode) {
        toggleSelection(item.id);
      }
    };

    const handleVideoNotePress = (item) => {
      const uri = item?.file_path || item?.video_url || item?.uri;
      if (uri) {
        const fullUri = uri.startsWith('http') ? uri : `${API_BASE_URL}${uri.startsWith('/') ? '' : '/'}${uri}`;
        setActiveVideoNote(fullUri);
        setVideoNoteIsPlaying(true);
        setIsVideoNoteModalVisible(true);
      }
    };

    const renderLeftActions = (progress, dragX) => {
      const scale = dragX.interpolate({
        inputRange: [0, 50, 80],
        outputRange: [0, 0.8, 1.2],
        extrapolate: 'clamp',
      });
      return (
        <View style={{ width: 80, justifyContent: 'center', alignItems: 'center' }}>
          <Animated.View style={{ transform: [{ scale }] }}>
            <MaterialIcons name="reply" size={24} color={colors.primary} />
          </Animated.View>
        </View>
      );
    };

    const isCurrentSearchResult = globalSearchResults[currentGlobalSearchIdx]?.id === item.id;
    const isReplyHighlighted = replyHighlightId === item.id;

    return (
      <Swipeable
        renderLeftActions={renderLeftActions}
        onSwipeableOpen={(direction, swipeable) => {
          if (direction === 'left') {
            handleReply(item);
            setTimeout(() => {
              swipeable?.close();
            }, 0);
          }
        }}
        leftThreshold={50}
        friction={2}
      >
        <Pressable 
          onPress={handlePress}
          onLongPress={handleLongPress}
          style={[
            styles.messageWrapper,
            isReceived ? styles.receivedWrapper : styles.sentWrapper,
              (isSelected || isCurrentSearchResult || isReplyHighlighted) && { 
                backgroundColor: isCurrentSearchResult 
                  ? colors.primary + '30' 
                  : (isReplyHighlighted ? colors.primary + '15' : colors.primary + '20') 
              },
              isGrouped && { marginTop: -2 },
              { zIndex: (isCurrentSearchResult || isReplyHighlighted) ? 10 : 1 }
            ]}
          >
            <View 
              style={[
                styles.messageBubble, 
                isReceived 
                  ? [styles.received, { backgroundColor: colors.surface }] 
                  : [styles.sent, { backgroundColor: colors.primary }],
                (isImage || isVideo) && !item.message && { padding: 4, overflow: 'hidden' },
                isVideoNote && { padding: 0, backgroundColor: 'transparent', elevation: 0, shadowOpacity: 0 },
                isSelected && !isReceived && { opacity: 0.8 },
                (isCurrentSearchResult || isReplyHighlighted) && { 
                  borderWidth: 1.5, 
                  borderColor: colors.primary, 
                  shadowColor: colors.primary,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.3,
                  shadowRadius: 4,
                  elevation: 3
                },
                { zIndex: (isCurrentSearchResult || isReplyHighlighted) ? 11 : 2 },
                isGrouped && (isReceived ? { borderTopLeftRadius: 18 } : { borderTopRightRadius: 18 })
              ]}
            >
          {item.reply_to && (
            <TouchableOpacity 
              activeOpacity={0.7}
              onPress={() => scrollToMessageById(item.reply_to.id)}
              style={[
                styles.replyMessageContainer, 
                { borderLeftColor: isReceived ? colors.primary : '#fff', backgroundColor: isReceived ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.1)' }
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                <MaterialIcons name="reply" size={12} color={isReceived ? colors.primary : '#fff'} style={{ marginRight: 4 }} />
                <Text style={[styles.replyMessageSender, { color: isReceived ? colors.primary : '#fff' }]} numberOfLines={1}>
                  {Number(item.reply_to.sender_id) === Number(currentUserId) ? 'Вы' : (item.reply_to.sender_name || 'Собеседник')}
                </Text>
              </View>
              <Text style={[styles.replyMessageText, { color: isReceived ? colors.textSecondary : 'rgba(255,255,255,0.8)' }]} numberOfLines={1}>
                {item.reply_to.message || (item.reply_to.message_type === 'image' ? 'Фотография' : (item.reply_to.message_type === 'voice' ? 'Голосовое сообщение' : 'Файл'))}
              </Text>
            </TouchableOpacity>
          )}
          {selectionMode && (
            <View style={styles.selectionIndicator}>
              <MaterialIcons 
                name={isSelected ? "check-circle" : "radio-button-unchecked"} 
                size={16} 
                color={isReceived ? (isSelected ? colors.primary : colors.textSecondary) : "#fff"} 
              />
            </View>
          )}
          {/* Медиа-группа */}
          {item.attachments && item.attachments.length > 0 ? (
            <View style={styles.mediaGridContainer}>
              <View style={styles.mediaGrid}>
                {item.attachments.map((att, idx) => {
                  if (!att.file_path || att.type === 'video_note') return null;
                  const attUri = att.file_path.startsWith('http') ? att.file_path : `${API_BASE_URL}${att.file_path}`;
                  
                  // Расчет размеров для сетки
                  const count = item.attachments.length;
                  let itemWidth = '100%';
                  let itemHeight = 200;
                  
                  if (count === 2) {
                    itemWidth = '49%';
                    itemHeight = 150;
                  } else if (count === 3) {
                    if (idx === 0) {
                      itemWidth = '100%';
                      itemHeight = 150;
                    } else {
                      itemWidth = '49%';
                      itemHeight = 100;
                    }
                  } else if (count >= 4) {
                    itemWidth = '49%';
                    itemHeight = 100;
                  }

                  return (
                    <Pressable 
                      key={`${item.id}_att_${idx}`}
                      onPress={() => handleFullScreen(attUri, att.type)}
                      style={{ 
                        width: itemWidth, 
                        height: itemHeight, 
                        borderRadius: 8, 
                        marginBottom: 4,
                        overflow: 'hidden'
                      }}
                    >
                      <CachedMedia 
                        item={{ ...att, message_type: att.type }} 
                        style={{ width: '100%', height: '100%' }}
                        onFullScreen={() => handleFullScreen(attUri, att.type)}
                        shouldPlay={viewableItems.includes(item.id)}
                        isStatic={true}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : (
            (isImage || isVideo) && (
              <View style={{ borderRadius: 12, overflow: 'hidden' }}>
                <CachedMedia 
                  item={item} 
                  onFullScreen={handleFullScreen} 
                  style={{ borderRadius: 12, overflow: 'hidden' }}
                  shouldPlay={viewableItems.includes(item.id)}
                  isStatic={true}
                />
              </View>
            )
          )}
          {isVoice && (
            <VoiceMessage 
              item={item} 
              currentUserId={currentUserId} 
              isParentVisible={viewableItems.includes(item.id)}
            />
          )}
          {isVideoNote && (
            <VideoNoteMessage 
              item={item} 
              isReceived={isReceived} 
              isParentVisible={viewableItems.includes(item.id)}
            />
          )}
          {item.attachments && item.attachments.some(att => att.type === 'video_note') && !isVideoNote && (
            item.attachments.filter(att => att.type === 'video_note').map((att, idx) => (
              <VideoNoteMessage 
                key={`att_vn_${idx}`}
                item={att} 
                isReceived={isReceived} 
                isParentVisible={viewableItems.includes(item.id)}
              />
            ))
          )}
          {isFile && (
            <View style={{ alignSelf: isReceived ? 'flex-start' : 'flex-end', minWidth: 220 }}>
              <FileMessage item={item} currentUserId={currentUserId} />
            </View>
          )}
          {item.message && (
            <View style={[
              (isImage || isVideo) && { marginTop: 5, marginHorizontal: 8, marginBottom: 4 }
            ]}>
              {renderMessageText(item.message, isReceived)}
            </View>
          )}
          <View style={styles.messageFooter}>
            <Text style={[
              styles.messageTime, 
              isReceived ? {color: colors.textSecondary} : {color: 'rgba(255,255,255,0.7)'}
            ]}>
              {formatMessageTime(item.timestamp)}
            </Text>
            {!isReceived && (
              <MaterialIcons 
                name={
                  item.status === 'pending' ? "schedule" : 
                  item.is_read ? "done-all" : "done"
                } 
                size={14} 
                color={
                  item.status === 'pending' ? "rgba(255,255,255,0.5)" :
                  item.is_read ? "#4CAF50" : "rgba(255,255,255,0.7)"
                } 
                style={styles.statusIcon}
              />
            )}
          </View>
        </View>
      </Pressable>
    </Swipeable>
    );
  };

  const handleDeleteMessage = (messageId) => {
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const isOwner = Number(message.sender_id) === Number(currentUserId);
    
    Alert.alert(
      'Удалить сообщение?',
      isOwner 
        ? 'Удалить это сообщение для всех участников?' 
        : 'Удалить это сообщение для себя? У собеседника оно останется.',
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive', 
          onPress: async () => {
            try {
              const sent = deleteMessageWs(messageId);
              if (!sent) {
                Alert.alert('Ошибка', 'Не удалось отправить запрос на удаление. Проверьте соединение.');
                return;
              }

              // Локально обновляем список сообщений
              setMessages(prev => prev.filter(m => String(m.id) !== String(messageId)));
              setSkip(prev => Math.max(0, prev - 1));
            } catch (error) {
              console.error('Failed to delete message', error);
              Alert.alert('Ошибка', 'Не удалось удалить сообщение');
            }
          }
        }
      ]
    );
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    
    const ownCount = messages.filter(m => selectedIds.includes(m.id) && m.sender_id !== userId).length;
    const othersCount = selectedIds.length - ownCount;
    
    let message = `Удалить выбранные сообщения (${selectedIds.length})?`;
    if (ownCount > 0 && othersCount > 0) {
      message = `Удалить ${selectedIds.length} сообщений? Ваши сообщения (${ownCount}) удалятся у всех, а чужие (${othersCount}) — только у вас.`;
    } else if (ownCount > 0) {
      message = `Удалить ваши сообщения (${ownCount}) для всех участников?`;
    } else {
      message = `Удалить чужие сообщения (${othersCount}) для себя? У собеседника они останутся.`;
    }

    Alert.alert(
      'Удалить сообщения?',
      message,
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive', 
          onPress: async () => {
            try {
              const sent = bulkDeleteMessagesWs(selectedIds);
              if (!sent) {
                Alert.alert('Ошибка', 'Не удалось отправить запрос на удаление. Проверьте соединение.');
                return;
              }

              // Локально обновляем список сообщений, чтобы чат сразу отразил удаление
              const removedCount = selectedIds.length;
              const idsToDelete = selectedIds.map(id => String(id));
              setMessages(prev => prev.filter(m => !idsToDelete.includes(String(m.id))));
              setSkip(prev => Math.max(0, prev - removedCount));

              setSelectionMode(false);
              setSelectedIds([]);
            } catch (error) {
              console.error('Failed to bulk delete messages', error);
              Alert.alert('Ошибка', 'Не удалось удалить сообщения');
            }
          }
        }
      ]
    );
  };
  

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={[styles.container, { backgroundColor: colors.background, flex: 1 }]}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      enabled={Platform.OS !== 'web'}
    >
      <View style={[styles.header, { 
        borderBottomColor: colors.border, 
        backgroundColor: colors.background, 
        paddingTop: insets.top || (Platform.OS === 'ios' ? 40 : 10) 
      }]}>
        {selectionMode ? (
          <View style={styles.selectionHeader}>
            <TouchableOpacity onPress={() => { setSelectionMode(false); setSelectedIds([]); }}>
              <MaterialIcons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.selectionTitle, { color: colors.text }]}>Выбрано: {selectedIds.length}</Text>
            <TouchableOpacity onPress={handleBulkDelete} disabled={selectedIds.length === 0}>
              <MaterialIcons name="delete" size={24} color={selectedIds.length > 0 ? colors.error : colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : isSearching ? (
          <View style={styles.searchBar}>
            <TextInput
              autoFocus
              style={[styles.searchInput, { color: colors.text, backgroundColor: colors.border + '44' }]}
              placeholder="Поиск..."
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={handleSearch}
            />
            {isLoadingSearchResults && (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />
            )}
            {searchQuery.length > 0 && globalSearchResults.length === 0 && !isLoadingSearchResults && (
               <Text style={[styles.noResultsText, { color: colors.error }]}>Нет</Text>
            )}
            <View style={styles.searchControls}>
              <View style={styles.searchNav}>
                {globalSearchResults.length > 0 && (
                  <Text style={[styles.searchCount, { color: colors.textSecondary }]}>
                    {currentGlobalSearchIdx + 1}/{globalSearchResults.length}
                  </Text>
                )}
                <TouchableOpacity 
                  onPress={prevSearchResult} 
                  style={[styles.searchNavItem, { opacity: globalSearchResults.length > 0 ? 1 : 0.3 }]}
                  disabled={globalSearchResults.length === 0}
                >
                  <MaterialIcons name="keyboard-arrow-up" size={28} color={colors.text} />
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={nextSearchResult} 
                  style={[styles.searchNavItem, { opacity: globalSearchResults.length > 0 ? 1 : 0.3 }]}
                  disabled={globalSearchResults.length === 0}
                >
                  <MaterialIcons name="keyboard-arrow-down" size={28} color={colors.text} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={toggleSearch} style={styles.searchClose}>
                <MaterialIcons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.headerInfoContainer}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.headerInfo} 
              onPress={() => navigation.navigate('UserProfile', { userId: userId })}
            >
              <View style={styles.headerAvatarContainer}>
                <Image 
                  source={{ uri: getAvatarUrl(interlocutor?.avatar_preview_url || interlocutor?.avatar_url) }} 
                  style={styles.headerAvatar} 
                />
                {interlocutor?.status === 'online' && (
                  <View style={[styles.headerOnlineBadge, { backgroundColor: '#4CAF50', borderColor: colors.background }]} />
                )}
              </View>
              <View>
                <Text style={[styles.headerTitle, { color: colors.text }]}>{formatName(interlocutor) || userName}</Text>
                {interlocutor && (
                  <Text style={[styles.headerStatus, { color: colors.textSecondary }]}>
                    {formatStatus(interlocutor.status, interlocutor.last_seen)}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.headerIconButton} 
              onPress={toggleSearch}
            >
              <MaterialIcons name="search" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
        )}
      </View>
      {!isChatConnected && (
        <View style={[styles.offlineBanner, { backgroundColor: colors.error + '22' }]}>
          <MaterialIcons name="cloud-off" size={16} color={colors.error} />
          <Text style={[styles.offlineText, { color: colors.error }]}>Соединение потеряно. Сообщения будут отправлены позже.</Text>
        </View>
      )}
      {uploadingProgress !== null && !uploadingData.uri && (
        <View style={[styles.uploadProgressContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.uploadProgressInfo}>
            <Text style={{ color: colors.text }}>
              {batchMode ? `Загрузка медиа (${attachmentsLocalCount + 1}/${batchTotal || 1}) - ${Math.round(uploadingProgress * 100)}%` : `Загрузка: ${formatFileSize(uploadingData.loaded)} / ${formatFileSize(uploadingData.total)} (${Math.round(uploadingProgress * 100)}%)`}
            </Text>
            <TouchableOpacity onPress={() => handleCancelUpload(activeUploadId)}>
              <MaterialIcons name="cancel" size={24} color={colors.error} />
            </TouchableOpacity>
          </View>
          <View style={styles.progressBarBackground}>
            <View style={[styles.progressBar, { width: `${uploadingProgress * 100}%`, backgroundColor: colors.primary }]} />
          </View>
        </View>
      )}
      <FlatList
        ref={chatFlatListRef}
        data={messages}
        extraData={[messages.length, currentUserId, selectedIds.length, theme, userId, viewableItems]}
        keyExtractor={(item) => `msg_${item.id !== undefined && item.id !== null ? String(item.id) : (item.client_id || Math.random())}`}
        renderItem={renderMessageItem}
        onEndReached={loadMoreMessages}
        onEndReachedThreshold={0.1}
        inverted={true}
        ListHeaderComponent={renderUploadPlaceholder}
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

      <Modal
        visible={!!fullScreenMedia}
        transparent={true}
        onRequestClose={() => setFullScreenMedia(null)}
      >
        <View style={styles.fullScreenContainer}>
          {(
            <View style={styles.fullScreenControlsTop}>
              <TouchableOpacity 
                style={styles.fullScreenIconButton} 
                onPress={handleDownloadMedia}
              >
                <MaterialIcons name="file-download" size={30} color="white" />
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.fullScreenIconButton} 
                onPress={() => setFullScreenMedia(null)}
              >
                <MaterialIcons name="close" size={30} color="white" />
              </TouchableOpacity>
            </View>
          )}
          
          <FlatList
            data={fullScreenMedia?.list || []}
            horizontal
            pagingEnabled
            initialScrollIndex={fullScreenMedia?.index || 0}
            getItemLayout={(_, index) => ({
              length: screenWidth,
              offset: screenWidth * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
              currentMediaIndexRef.current = index;
              setCurrentMediaIndex(index);
              
              // Синхронизация чата: прокручиваем к сообщению, из которого это медиа
              const mediaItem = fullScreenMedia?.list[index];
              if (mediaItem && mediaItem.messageId) {
                const msgIndex = messages.findIndex(m => m.id === mediaItem.messageId);
                if (msgIndex !== -1) {
                  chatFlatListRef.current?.scrollToIndex({ 
                    index: msgIndex, 
                    animated: true, 
                    viewPosition: 0.5 
                  });
                }
              }
            }}
            keyExtractor={(_, i) => `fs_media_${i}`}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item: mediaItem, index }) => (
              <View style={{ width: screenWidth, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                <CachedMedia 
                  item={mediaItem}
                  style={styles.fullScreenVideo}
                  resizeMode="contain"
                  useNativeControls={false}
                  isLooping={false}
                  shouldPlay={currentMediaIndex === index}
                  isMuted={false}
                  isStatic={index !== currentMediaIndex}
                  onPlayerReady={(player) => {
                    fullScreenPlayersByIndex.current.set(index, player);
                    if (index === currentMediaIndex) {
                      try {
                        player.playbackRate = fullScreenPlaybackRate;
                      } catch (e) {
                        console.log('[FullScreenVideo] onPlayerReady: Failed to set playbackRate:', e);
                      }
                      attachFullScreenPlayer(player);
                    }
                  }}
                />

                <Pressable style={StyleSheet.absoluteFill} onPress={toggleFullScreenControls}>
                  {showFullScreenControls && (mediaItem.message_type === 'video' || mediaItem.type === 'video') && (
                    <View style={styles.fullScreenCenterButtonContainer}>
                      <TouchableOpacity 
                        style={styles.fullScreenCenterPlayButton} 
                        onPress={handleFullScreenPlayPause}
                      >
                        <MaterialIcons 
                          name={fullScreenIsPlaying ? "pause" : "play-arrow"} 
                          size={50} 
                          color="white" 
                        />
                      </TouchableOpacity>
                    </View>
                  )}
                </Pressable>
              </View>
            )}
          />

          {showFullScreenControls && (fullScreenMedia?.list[currentMediaIndex]?.type === 'video' || fullScreenMedia?.list[currentMediaIndex]?.message_type === 'video') && (
            <View style={styles.fullScreenControlsBottom}>
              <View style={{ position: 'absolute', top: -50, right: 20 }}>
                <TouchableOpacity 
                  onPress={handleFullScreenToggleRate} 
                  style={{ backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }}
                >
                  <Text style={{ color: 'white', fontWeight: 'bold' }}>{fullScreenPlaybackRate}x</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.fullScreenTimelineRow}>
                <Text style={styles.fullScreenTimeText}>
                  {formatMediaTime(isSeekingFullScreen ? (seekingPositionFullScreen ?? fullScreenPosition) : fullScreenPosition)}
                </Text>

                <View
                  style={styles.fullScreenSliderContainer}
                  onLayout={(e) => { const w = e.nativeEvent.layout.width || 1; fsSliderWidthRef.current = w; setFullScreenSliderWidth(w); }}
                  {...fullScreenSliderPanResponder.panHandlers}
                >
                  <View style={styles.fullScreenSliderTrack} pointerEvents="none" />
                  <View
                    pointerEvents="none"
                    style={[
                      styles.fullScreenSliderFill,
                      {
                        width: `${
                          fullScreenDuration > 0
                            ? (
                                ((isSeekingFullScreen ? (seekingPositionFullScreen ?? fullScreenPosition) : fullScreenPosition) / fullScreenDuration) *
                                100
                              ).toFixed(2)
                            : 0
                        }%`,
                      },
                    ]}
                  />
                  <View
                    pointerEvents="none"
                    style={[
                      styles.fullScreenSliderThumb,
                      {
                        left:
                          fullScreenDuration > 0
                            ? Math.max(
                                0,
                                Math.min(
                                  fullScreenSliderWidth - 12,
                                  ((isSeekingFullScreen ? (seekingPositionFullScreen ?? fullScreenPosition) : fullScreenPosition) / fullScreenDuration) *
                                    fullScreenSliderWidth -
                                    6
                                )
                              )
                            : 0,
                      },
                    ]}
                  />
                </View>

                <Text style={styles.fullScreenTimeText}>{formatMediaTime(fullScreenDuration)}</Text>
              </View>
            </View>
          )}
        </View>
      </Modal>

      <Modal
        visible={isVideoNoteModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleVideoNoteModalClose}
      >
        <Pressable 
          style={styles.videoNoteModalOverlay} 
          onPress={handleVideoNoteModalClose}
        >
          <View style={styles.videoNoteModalContent}>
            <View 
              style={styles.videoNoteSliderContainer}
              onLayout={(e) => setVideoNoteSliderWidth(e.nativeEvent.layout.width || 320)}
              {...videoNotePanResponder.panHandlers}
            >
              <View style={styles.videoNoteModalCircle}>
                {activeVideoNote && (
                  <VideoPlayer
                    uri={activeVideoNote}
                    style={styles.videoNoteModalVideo}
                    onClose={handleVideoNoteModalClose}
                    hideControls={true}
                    shouldPlay={videoNoteIsPlaying}
                    isLooping={false}
                    onPlayerReady={handleVideoNotePlayerReady}
                  />
                )}
                {/* Круговой прогресс */}
                <View style={styles.videoNoteProgressRing}>
                   {/* В реальном приложении здесь лучше использовать react-native-svg 
                       Для имитации кольцевого прогресса без SVG, мы используем 
                       слайдер снизу и круглую рамку.
                   */}
                </View>
              </View>

              {/* Линейный прогресс под кругом (как альтернатива или дополнение для удобства перемотки) */}
              <View style={styles.videoNoteProgressBar}>
                <View style={[
                  styles.videoNoteProgressFill,
                  { 
                    width: `${videoNoteDuration > 0 
                      ? (((isVideoNoteSeeking ? videoNoteSeekingPosition : videoNotePosition) / videoNoteDuration) * 100).toFixed(2) 
                      : 0}%` 
                  }
                ]} />
              </View>
            </View>

            <View style={styles.videoNoteControlsRow}>
              <Text style={styles.videoNoteTimeText}>
                {formatMediaTime(isVideoNoteSeeking ? videoNoteSeekingPosition : videoNotePosition)}
              </Text>
              
              <TouchableOpacity 
                style={styles.videoNotePlayPauseBtn} 
                onPress={handleVideoNoteTogglePlay}
              >
                <MaterialIcons 
                  name={videoNoteIsPlaying ? "pause" : "play-arrow"} 
                  size={32} 
                  color="#fff" 
                />
              </TouchableOpacity>

              <Text style={styles.videoNoteTimeText}>
                {formatMediaTime(videoNoteDuration)}
              </Text>
            </View>

            <TouchableOpacity 
              style={styles.videoNoteModalClose} 
              onPress={handleVideoNoteModalClose}
            >
              <MaterialIcons name="close" size={30} color="#fff" />
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {!selectionMode && (
        <View style={[
          styles.inputContainer, 
          { 
            backgroundColor: colors.background, 
            borderTopColor: colors.border, 
            borderTopWidth: 1,
            paddingBottom: Platform.OS === 'web' 
              ? 20 
              : (isKeyboardVisible ? 5 : Math.max(insets.bottom, 12) + 5),
            flexDirection: 'column'
          }
        ]}>
          {replyingToMessage && (
            <View style={styles.replyPreviewContainer}>
              <View style={[styles.replyPreviewBorder, { backgroundColor: colors.primary }]} />
              <View style={styles.replyPreviewContent}>
                <Text style={[styles.replyPreviewSender, { color: colors.primary }]} numberOfLines={1}>
                  {Number(replyingToMessage.sender_id) === Number(currentUserId) ? 'Вы' : (interlocutor?.first_name || 'Собеседник')}
                </Text>
                <Text style={[styles.replyPreviewText, { color: colors.textSecondary }]} numberOfLines={1}>
                  {replyingToMessage.message || (replyingToMessage.message_type === 'image' ? 'Фотография' : (replyingToMessage.message_type === 'voice' ? 'Голосовое сообщение' : 'Файл'))}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyingToMessage(null)} style={styles.replyPreviewClose}>
                <MaterialIcons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
            {pendingVideoNoteUri ? (
            <View style={styles.recordedContainer}>
              <TouchableOpacity onPress={() => setPendingVideoNoteUri(null)} style={styles.deleteRecordingButton}>
                <MaterialIcons name="delete" size={24} color={colors.error} />
              </TouchableOpacity>
              <View style={styles.recordingWaveformPlaceholder}>
                <MaterialIcons name="videocam" size={20} color={colors.primary} />
                <Text style={[styles.recordingTimeText, { color: colors.text }]}>Видеосообщение</Text>
              </View>
              <TouchableOpacity onPress={() => { handleSendVideoNote(pendingVideoNoteUri); setPendingVideoNoteUri(null); }} style={[styles.sendButton, { marginRight: 10 }]}>
                <MaterialIcons name="send" size={24} color={colors.primary} />
              </TouchableOpacity>
            </View>
          ) : recordedUri ? (
            <View style={styles.recordedContainer}>
              <TouchableOpacity onPress={deleteRecording} style={styles.deleteRecordingButton}>
                <MaterialIcons name="delete" size={24} color={colors.error} />
              </TouchableOpacity>
              <View style={styles.recordingWaveformPlaceholder}>
                <MaterialIcons name="mic" size={20} color={colors.primary} />
                <Text style={[styles.recordingTimeText, { color: colors.text }]}>Голосовое сообщение ({formatRecordingTime(recordingDuration)})</Text>
              </View>
              <TouchableOpacity onPress={() => uploadVoiceMessage(recordedUri)} style={[styles.sendButton, { marginRight: 10 }]}>
                <MaterialIcons name="send" size={24} color={colors.primary} />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {!isRecording && (
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity 
                    onPress={pickAndUploadDocument} 
                    style={styles.attachButton}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialIcons name="insert-drive-file" size={24} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={pickAndUploadFile} 
                    style={styles.attachButton}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialIcons name="image" size={24} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              )}
              
              {(isRecording || isVideoRecording) ? (
                <View style={styles.recordingContainer}>
                  <View style={styles.recordingIndicator}>
                    <Animated.View style={[styles.recordingDot, { opacity: recordingDotOpacity }]} />
                    <Text style={[styles.recordingTimeText, { color: colors.error }]}>
                      {isVideoRecording ? "Запись видео..." : formatRecordingTime(recorderStatus.durationMillis || recordingDuration)}
                    </Text>
                  </View>
                  <Text style={[styles.recordingHint, { color: colors.textSecondary }]}>Отпустите для завершения</Text>
                </View>
              ) : (
                <TextInput
                  ref={textInputRef}
                  style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder="Сообщение..."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                />
              )}

              {(inputText.trim() && !isRecording && !isVideoRecording) ? (
                <TouchableOpacity onPress={sendMessage} style={[styles.sendButton, { marginRight: 10 }]}>
                  <MaterialIcons name="send" size={24} color={colors.primary} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity 
                  onLongPress={inputMode === 'audio' ? startRecording : startVideoRecording} 
                  onPressOut={inputMode === 'audio' ? stopRecording : stopVideoRecording}
                  onPress={() => {
                    Vibration.vibrate(50);
                    setInputMode(prev => prev === 'audio' ? 'video' : 'audio');
                  }}
                  delayLongPress={200}
                  style={[
                    styles.sendButton, 
                    { marginRight: 10 },
                    (isRecording || isVideoRecording) && { backgroundColor: colors.primary + '20', borderRadius: 20 }
                  ]}
                >
                  <MaterialIcons 
                    name={inputMode === 'audio' ? (isRecording ? "mic" : "mic-none") : "videocam"} 
                    size={24} 
                    color={(isRecording || isVideoRecording) ? colors.error : colors.primary} 
                  />
                </TouchableOpacity>
              )}
            </>
          )}
          </View>
        </View>
      )}
      {isVideoRecording && (
        <View style={styles.videoPreviewOverlay}>
          <View style={styles.videoPreviewContainer}>
            <CameraView
              ref={cameraRef}
              style={styles.videoPreview}
              facing="front"
              mode="video"
            />
            <View style={styles.videoRecordingTimerContainer}>
              <View style={styles.videoRecordingDot} />
              <Text style={styles.videoRecordingTimerText}>
                {Math.floor(isVideoRecordingTimer / 60)}:{isVideoRecordingTimer % 60 < 10 ? '0' : ''}{isVideoRecordingTimer % 60}
              </Text>
            </View>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    ...Platform.select({
      web: {
        height: '100vh',
        maxHeight: '100vh',
        overflow: 'hidden'
      }
    })
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    flexShrink: 0,
    ...getShadow('#000', { width: 0, height: 1 }, 0.1, 1, 2),
  },
  headerInfoContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconButton: {
    padding: 8,
    borderRadius: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    flex: 1,
  },
  searchInput: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  searchControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchNav: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 15,
    marginLeft: 4,
    paddingLeft: 4,
  },
  searchCount: {
    fontSize: 10,
    fontWeight: '600',
    minWidth: 24,
    textAlign: 'center',
  },
  searchNavItem: {
    padding: 0,
  },
  noResultsText: {
    fontSize: 10,
    marginHorizontal: 4,
    fontStyle: 'italic',
  },
  searchClose: {
    padding: 4,
    marginLeft: 2,
  },
  scrollDownButton: {
    position: 'absolute',
    bottom: 80,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    zIndex: 10,
  },
  backButton: {
    marginRight: 10,
    padding: 5,
  },
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  headerAvatarContainer: {
    position: 'relative',
  },
  headerOnlineBadge: {
    position: 'absolute',
    right: 8,
    bottom: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    zIndex: 1
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerStatus: {
    fontSize: 12,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  offlineText: {
    fontSize: 12,
    marginLeft: 6,
    fontWeight: '500',
  },
  messageWrapper: {
    flexDirection: 'row',
    marginVertical: 5,
    paddingHorizontal: 10,
    alignItems: 'flex-end',
  },
  receivedWrapper: {
    justifyContent: 'flex-start',
  },
  sentWrapper: {
    justifyContent: 'flex-end',
  },
  mediaGridContainer: {
    width: 260,
    marginTop: 2,
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  messageBubble: { 
    padding: 12, 
    borderRadius: 18, 
    maxWidth: '85%',
    ...getShadow('#000', { width: 0, height: 1 }, 0.1, 2, 1),
  },
  sent: { 
    alignSelf: 'flex-end', 
    borderBottomRightRadius: 2, 
    elevation: 2 
  },
  received: { 
    alignSelf: 'flex-start', 
    borderBottomLeftRadius: 2, 
    elevation: 1 
  },
  messageText: { fontSize: 16, lineHeight: 22 },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
    alignSelf: 'flex-end',
  },
  messageTime: {
    fontSize: 10,
    marginRight: 4,
  },
  statusIcon: {
    marginLeft: 2,
  },
  inputContainer: { flexDirection: 'row', padding: 10, flexShrink: 0 },
  selectionHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
  },
  selectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 15,
    flex: 1,
  },
  selectionIndicator: {
    position: 'absolute',
    top: 5,
    right: 5,
    zIndex: 1,
  },
  input: { 
    flex: 1, 
    borderWidth: 1, 
    borderRadius: 24, 
    paddingHorizontal: 16, 
    paddingTop: 8,
    paddingBottom: 8,
    minHeight: 40,
    maxHeight: 120,
    fontSize: 16 
  },
  sendButton: { justifyContent: 'center', marginLeft: 10 },
  sendButtonText: { color: '#007AFF', fontWeight: 'bold' },
  attachButton: { justifyContent: 'center', marginRight: 10, paddingHorizontal: 10 },
  attachButtonText: { fontSize: 24, color: '#007AFF' },
  recordingContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    height: 40,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ff3b30',
    marginRight: 8,
  },
  recordingTimeText: {
    fontSize: 16,
    fontWeight: '500',
  },
  recordingHint: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  recordedContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    height: 40,
  },
  deleteRecordingButton: {
    padding: 5,
  },
  recordingWaveformPlaceholder: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 20,
    paddingHorizontal: 15,
    height: 36,
    marginHorizontal: 10,
  },
  uploadProgressContainer: { 
    padding: 10, 
    backgroundColor: '#fff', 
    borderBottomWidth: 1, 
    borderColor: '#eee' 
  },
  uploadProgressInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  progressBarBackground: {
    height: 4,
    backgroundColor: '#eee',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: { 
    height: '100%', 
  },
  fileLinkText: { color: '#fff', textDecorationLine: 'underline', marginBottom: 5 },
  fullScreenContainer: { flex: 1, backgroundColor: 'black' },
  fullScreenImage: { width: '100%', height: '100%' },
  fullScreenVideo: { width: '100%', height: '100%' },
  // Fullscreen media controls (custom)
  fullScreenControlsTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 40,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  fullScreenIconButton: {
    padding: 6,
  },
  fullScreenControlsBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: 22,
    paddingTop: 20,
    zIndex: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  fullScreenCenterButtonContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenCenterPlayButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenTimelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fullScreenTimeText: {
    color: '#fff',
    fontSize: 12,
    width: 48,
    textAlign: 'center',
  },
  fullScreenSliderContainer: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
    marginHorizontal: 10,
  },
  fullScreenSliderTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  fullScreenSliderFill: {
    position: 'absolute',
    left: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  fullScreenSliderThumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#fff',
  },

  // Legacy (kept for compatibility; not used by custom controls)
  closeButton: { position: 'absolute', top: 40, right: 20, zIndex: 10 },
  downloadButton: { position: 'absolute', top: 40, left: 20, zIndex: 10 },
  videoPreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  videoPreviewContainer: {
    width: 250,
    height: 250,
    borderRadius: 125,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: '#000',
  },
  videoPreview: {
    width: '100%',
    height: '100%',
  },
  videoRecordingTimerContainer: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  videoRecordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff3b30',
    marginRight: 6,
  },
  videoRecordingTimerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  videoNoteModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoNoteModalContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoNoteModalCircle: {
    width: 320,
    height: 320,
    borderRadius: 160,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 0,
    borderColor: 'rgba(255,255,255,0.2)',
    ...getShadow('#000', { width: 0, height: 10 }, 0.5, 20, 15),
  },
  videoNoteSliderContainer: {
    width: 320,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoNoteProgressBar: {
    width: 280,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    marginTop: 20,
    overflow: 'hidden',
  },
  videoNoteProgressFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 2,
  },
  videoNoteControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
    width: 280,
    justifyContent: 'space-between',
  },
  videoNoteTimeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    width: 60,
    textAlign: 'center',
  },
  videoNotePlayPauseBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  videoNoteProgressRing: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 164,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  videoNoteModalVideo: {
    width: '100%',
    height: '100%',
  },
  videoNoteModalClose: {
    marginTop: 30,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  replyPreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
    backgroundColor: 'transparent',
    width: '100%',
  },
  replyPreviewBorder: {
    width: 3,
    height: '100%',
    borderRadius: 2,
    marginRight: 10,
  },
  replyPreviewContent: {
    flex: 1,
    justifyContent: 'center',
  },
  replyPreviewSender: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  replyPreviewText: {
    fontSize: 12,
  },
  replyPreviewClose: {
    padding: 5,
  },
  replyMessageContainer: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
    marginBottom: 4,
    borderLeftWidth: 3,
  },
  replyMessageSender: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  replyMessageText: {
    fontSize: 11,
  },
});
