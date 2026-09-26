import React, { useState, useEffect } from 'react';
import { View, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { cacheDirectory, getInfoAsync, createDownloadResumable } from 'expo-file-system/legacy';
import { API_BASE_URL } from '../constants';
import VideoPlayer from './VideoPlayer';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { subscribe, startDownload, checkCached, getState } from '../utils/downloadManager';

const formatBytes = (bytes) => {
  if (!bytes || bytes <= 0) return '0 КБ';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${Math.round(bytes / 1024)} КБ`;
};

const CachedMedia = ({
  item,
  onFullScreen,
  style,
  resizeMode = 'cover',
  useNativeControls = false,
  shouldPlay = true,
  isMuted = true,
  onPlayerReady,
  isLooping,
  isStatic = false,
  isParentVisible = true,
  onDownloadProgress,
}) => {
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const isVideo = item.message_type === 'video' || item.type === 'video';
  const remoteUri =
    item.file_path && (item.file_path.startsWith('http') || item.file_path.startsWith('file://') || item.file_path.startsWith('content://'))
      ? item.file_path
      : item.file_path
      ? `${API_BASE_URL}${item.file_path}`
      : '';
  const fileName = item.file_path ? item.file_path.split('/').pop() : 'unknown';
  const localFileUri = `${cacheDirectory}${fileName}`;
  const doneMarkerUri = `${localFileUri}.done`;

  const [localUri, setLocalUri] = useState(null);
  const [loading, setLoading] = useState(true);
  // Ленивая инициализация из глобального хранилища загрузок: если видео уже докачано
  // (или качается) другим экземпляром CachedMedia для того же файла — сразу показываем
  // актуальное состояние, а не "не скачано" на первом кадре.
  const [dlState, setDlState] = useState(() => (
    isVideo && remoteUri
      ? getState(remoteUri)
      : { downloading: false, downloadedBytes: 0, totalBytes: 0, cached: false, localUri: null }
  ));
  // Видео с удалённого сервера (http/https) считается готовым к показу только после
  // полной докачки на диск — это исключает проигрывание потокового URL и, как следствие,
  // переключение источника во время просмотра. Локальные файлы (file://, content://)
  // готовы сразу, докачка для них не требуется.
  const isRemoteHttp = /^https?:\/\//i.test(remoteUri || '');
  const isVideoReady = !isVideo || !isRemoteHttp || (dlState.cached && !!dlState.localUri);

  // Subscribe to global download store for this video
  useEffect(() => {
    if (!isVideo || !remoteUri) return;
    const unsub = subscribe(remoteUri, (state) => {
      setDlState(state);
      if (onDownloadProgress) {
        if (state.cached) {
          onDownloadProgress(-1, 0, false, true);
        } else if (state.downloading) {
          onDownloadProgress(state.downloadedBytes, state.totalBytes, false);
        }
      }
      if (state.cached && state.localUri) {
        setLocalUri(state.localUri);
      }
    });
    return unsub;
  }, [remoteUri]);

  // Start download when fullscreen player is visible
  useEffect(() => {
    if (isVideo && !isStatic && isParentVisible && shouldPlay && remoteUri) {
      startDownload(remoteUri, localFileUri, doneMarkerUri);
    }
  }, [remoteUri, isParentVisible, shouldPlay]);

  // Проверяем при входе в чат (монтировании превью), скачано ли видео на телефон,
  // чтобы значок сразу показывал актуальный статус, а не "не скачано" по умолчанию
  useEffect(() => {
    if (!isVideo || !remoteUri) return;
    checkCached(remoteUri, localFileUri, doneMarkerUri);
  }, [remoteUri]);

  // Initial load
  useEffect(() => {
    if (!item.file_path) { setLoading(false); return; }

    if (item.file_path.startsWith('file://') || item.file_path.startsWith('content://')) {
      setLocalUri(item.file_path);
      setLoading(false);
      return;
    }

    const loadMedia = async () => {
      try {
        if (isVideo) {
          setLocalUri(remoteUri);
          setLoading(false);
        } else {
          const fileInfo = await getInfoAsync(localFileUri);
          if (fileInfo.exists && fileInfo.size > 0) {
            setLocalUri(fileInfo.uri);
            setLoading(false);
            return;
          }
          const dl = createDownloadResumable(remoteUri, localFileUri, {});
          const res = await dl.downloadAsync();
          setLocalUri(res?.uri || remoteUri);
          setLoading(false);
        }
      } catch (e) {
        console.error('[CachedMedia] loadMedia error:', e);
        setLocalUri(remoteUri);
        setLoading(false);
      }
    };

    loadMedia();
  }, [item.file_path]);

  if (loading) {
    return (
      <View style={[styles.loaderContainer, style, { backgroundColor: isVideo ? '#000' : (style?.backgroundColor || colors.surface) }]}>
        <ActivityIndicator size={isVideo ? 'large' : 'small'} color={isVideo ? '#fff' : colors.primary} />
      </View>
    );
  }

  // Video placeholder (not playing inline)
  if (isVideo && (!isParentVisible || isStatic || !shouldPlay)) {
    const handleVideoTap = () => {
      if (isVideoReady) {
        if (onFullScreen) onFullScreen(dlState.localUri || localUri, item.message_type || item.type);
        return;
      }
      // Видео ещё не докачано полностью — не открываем плеер сразу (иначе при одновременной
      // докачке нескольких видео это приводило к ошибке). Просто запускаем/продолжаем загрузку —
      // плеер не открывается автоматически, после докачки пользователь должен нажать на
      // воспроизведение ещё раз.
      if (remoteUri) startDownload(remoteUri, localFileUri, doneMarkerUri);
    };

    const { downloading, downloadedBytes, totalBytes, cached } = dlState;

    return (
      <TouchableOpacity onPress={handleVideoTap} style={[styles.thumbnail, style]} activeOpacity={0.85}>
        {/* Не создаём здесь настоящий VideoPlayer/VideoView (shouldPlay всегда false для этого
            превью) — раньше он всё равно инициализировал полноценный нативный плеер и decoder
            только чтобы показать статичный первый кадр. В чате с несколькими видео-сообщениями
            это означало по одному живому нативному плееру на КАЖДОЕ видео в истории одновременно,
            что и приводило к OutOfMemoryError. Настоящий плеер теперь создаётся только при
            открытии видео полноэкранно (ниже). */}
        <View style={[StyleSheet.absoluteFill, styles.thumbnailPlaceholder]} />
        <View style={styles.playOverlay}>
          <View style={styles.playButtonCircle}>
            <MaterialIcons name="play-arrow" size={32} color="#fff" />
          </View>
        </View>
        <View style={styles.statusBadge} pointerEvents="none">
          {cached && !downloading ? (
            <MaterialIcons name="download-done" size={18} color="#4CAF50" />
          ) : downloading ? (
            <>
              <ActivityIndicator size={12} color="#4FC3F7" style={{ marginBottom: 2 }} />
              {downloadedBytes > 0 && (
                <Text style={styles.statusBytesText}>
                  {totalBytes > 0
                    ? `${formatBytes(downloadedBytes)}\n/ ${formatBytes(totalBytes)}`
                    : formatBytes(downloadedBytes)}
                </Text>
              )}
              {totalBytes > 0 && downloadedBytes > 0 && (
                <View style={styles.statusProgressTrack}>
                  <View style={[styles.statusProgressFill, { width: `${Math.min(downloadedBytes / totalBytes, 1) * 100}%` }]} />
                </View>
              )}
            </>
          ) : (
            <MaterialIcons name="cloud-download" size={18} color="rgba(255,255,255,0.7)" />
          )}
        </View>
      </TouchableOpacity>
    );
  }

  // Fullscreen video player
  if (isVideo) {
    const { downloading, downloadedBytes, totalBytes } = dlState;
    return (
      <View style={[styles.thumbnailOuter, style]}>
        <View style={styles.thumbnailInner}>
          {isVideoReady ? (
            <VideoPlayer
              uri={dlState.localUri || localUri}
              isMuted={isMuted}
              isLooping={typeof isLooping === 'boolean' ? isLooping : !useNativeControls}
              shouldPlay={shouldPlay}
              style={StyleSheet.absoluteFill}
              useNativeControls={useNativeControls}
              resizeMode={resizeMode}
              onPlayerReady={onPlayerReady}
            />
          ) : (
            // Пока файл не докачан полностью — не создаём плеер с потоковым URL вообще, чтобы
            // видео не могло начать проигрываться и затем переключить источник на локальный
            // файл (именно это раньше вызывало видимый рестарт воспроизведения с начала).
            <View style={[StyleSheet.absoluteFill, styles.fullscreenWaitContainer]}>
              <ActivityIndicator size="large" color="#fff" />
            </View>
          )}
          {onFullScreen && (
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              onPress={() => onFullScreen(dlState.localUri || localUri, item.message_type || item.type)}
            />
          )}
        </View>
        {downloading && (
          <View style={styles.fullscreenBadge} pointerEvents="none">
            <ActivityIndicator size={10} color="#4FC3F7" style={{ marginRight: 4 }} />
            {downloadedBytes > 0 && (
              <Text style={styles.fullscreenBytesText}>
                {totalBytes > 0
                  ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
                  : formatBytes(downloadedBytes)}
              </Text>
            )}
          </View>
        )}
      </View>
    );
  }

  // Image
  return (
    <TouchableOpacity
      disabled={!onFullScreen}
      onPress={() => onFullScreen && onFullScreen(localUri, item.message_type || item.type)}
      style={[styles.thumbnail, style]}
    >
      <Image source={{ uri: localUri }} style={StyleSheet.absoluteFill} resizeMode={resizeMode} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  loaderContainer: {
    width: 200,
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
  },
  thumbnailOuter: {
    width: 200,
    height: 150,
    borderRadius: 14,
    backgroundColor: '#000',
  },
  thumbnailInner: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    overflow: 'hidden',
  },
  thumbnail: {
    width: 200,
    height: 150,
    borderRadius: 14,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  thumbnailPlaceholder: {
    backgroundColor: '#000',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  playButtonCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  statusBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 5,
    alignItems: 'center',
    minWidth: 28,
  },
  statusBytesText: {
    color: '#4FC3F7',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 2,
  },
  statusProgressTrack: {
    width: 40,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 2,
  },
  statusProgressFill: {
    height: 3,
    backgroundColor: '#4FC3F7',
    borderRadius: 2,
  },
  fullscreenBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  fullscreenWaitContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  fullscreenBytesText: {
    color: '#4FC3F7',
    fontSize: 9,
    fontWeight: '700',
  },
});

export default CachedMedia;
