import { useEffect, useRef, useState } from 'react';
import { Alert, Dimensions, PanResponder, Platform, StatusBar } from 'react-native';
import { documentDirectory, getInfoAsync, downloadAsync, readAsStringAsync, writeAsStringAsync, EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { setPlaybackAudioMode } from '../../../utils/audioSettings';
import { collectMediaFromMessages } from '../utils';

// Полноэкранный просмотр фото/видео: список медиа, плеер, слайдер перемотки, скачивание
export default function useFullScreenMedia({ messages, chatFlatListRef }) {
  const [fullScreenMedia, setFullScreenMedia] = useState(null); // { index, list }
  const [fsDownloadedBytes, setFsDownloadedBytes] = useState(0);
  const [fsTotalBytes, setFsTotalBytes] = useState(0);
  const [fsDownloading, setFsDownloading] = useState(false);
  const [fsIsStalled, setFsIsStalled] = useState(false);
  const [fsCached, setFsCached] = useState(false);
  const [allMedia, setAllMedia] = useState([]);

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
  const [isSeekingFullScreen, setIsSeekingFullScreen] = useState(false);
  const [seekingPositionFullScreen, setSeekingPositionFullScreen] = useState(null);
  const fsSliderWidthRef = useRef(1);
  const fsDurationRef = useRef(0);
  const fsSeekingPosRef = useRef(null);
  const fsPositionRef = useRef(0);
  const fsIsSeekingRef = useRef(false);
  const currentMediaIndexRef = useRef(0);
  const seekFullScreenToRatioRef = useRef(null);

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
      setPlaybackAudioMode().finally(() => {
        try { player.play(); } catch (_) {}
      });
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
    setAllMedia(collectMediaFromMessages(messages));
  }, [messages]);

  const closeFullScreen = () => {
    setFullScreenMedia(null);
  };

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

  // Переключение на другой элемент при горизонтальном свайпе
  const handleMediaIndexChange = (index) => {
    currentMediaIndexRef.current = index;
    setCurrentMediaIndex(index);
    setFsDownloading(false);
    setFsDownloadedBytes(0);
    setFsTotalBytes(0);
    setFsIsStalled(false);
    setFsCached(false);
    
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
  };

  const handleDownloadProgress = (index, downloaded, total, stalled, isCached) => {
    if (index !== currentMediaIndexRef.current) return;
    if (downloaded === -1) {
      setFsDownloading(false);
      if (isCached) setFsCached(true);
    } else {
      setFsCached(false);
      setFsDownloading(downloaded >= 0);
      setFsDownloadedBytes(downloaded);
      setFsTotalBytes(total);
      setFsIsStalled(stalled);
    }
  };

  const handlePlayerReady = (index, player) => {
    fullScreenPlayersByIndex.current.set(index, player);
    if (index === currentMediaIndex) {
      try {
        player.playbackRate = fullScreenPlaybackRate;
      } catch (e) {
        console.log('[FullScreenVideo] onPlayerReady: Failed to set playbackRate:', e);
      }
      attachFullScreenPlayer(player);
    }
  };

  const handleSliderLayout = (e) => {
    const w = e.nativeEvent.layout.width || 1;
    fsSliderWidthRef.current = w;
    setFullScreenSliderWidth(w);
  };

  return {
    openFullScreen,
    // props для FullScreenMediaViewer
    viewerProps: {
      fullScreenMedia,
      screenWidth,
      currentMediaIndex,
      showFullScreenControls,
      fullScreenPosition,
      fullScreenDuration,
      fullScreenIsPlaying,
      fullScreenPlaybackRate,
      fullScreenSliderWidth,
      isSeekingFullScreen,
      seekingPositionFullScreen,
      fsDownloading,
      fsDownloadedBytes,
      fsTotalBytes,
      fsIsStalled,
      fsCached,
      sliderPanHandlers: fullScreenSliderPanResponder.panHandlers,
      onClose: closeFullScreen,
      onDownload: handleDownloadMedia,
      onToggleControls: toggleFullScreenControls,
      onPlayPause: handleFullScreenPlayPause,
      onToggleRate: handleFullScreenToggleRate,
      onStop: handleFullScreenStop,
      onMediaIndexChange: handleMediaIndexChange,
      onDownloadProgress: handleDownloadProgress,
      onPlayerReady: handlePlayerReady,
      onSliderLayout: handleSliderLayout,
    },
  };
}
