import React, { useState, useEffect, useRef } from 'react';
import { View, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Text, Alert, Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { cacheDirectory, getInfoAsync, createDownloadResumable, copyAsync, readAsStringAsync, writeAsStringAsync, EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { API_BASE_URL } from '../constants';
import FullScreenVideoPlayer from './FullScreenVideoPlayer';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { subscribe, startDownload, checkCached, getState, invalidateCache } from '../utils/downloadManager';

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
  const thumbFileUri = `${cacheDirectory}thumb_${fileName}.jpg`;

  const [localUri, setLocalUri] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Статичный кадр видео для превью (чтобы не показывать чёрный прямоугольник вместо
  // реального содержимого ролика). Генерируется один раз и кешируется на диске —
  // полноценный VideoPlayer при этом НЕ создаётся, поэтому проблема с OutOfMemoryError
  // при большом числе видео в чате не возвращается.
  const [thumbUri, setThumbUri] = useState(null);
  // Ленивая инициализация из глобального хранилища загрузок: если видео уже докачано
  // (или качается) другим экземпляром CachedMedia для того же файла — сразу показываем
  // актуальное состояние, а не "не скачано" на первом кадре.
  const [dlState, setDlState] = useState(() => (
    isVideo && remoteUri
      ? getState(remoteUri)
      : { downloading: false, downloadedBytes: 0, totalBytes: 0, cached: false, localUri: null }
  ));
  // Полноэкранный плеер (как и в ленте) создаётся только после того, как видео полностью
  // оказалось в кэше - для удалённых http-файлов это и есть ожидание полной докачки,
  // а уже локальные (file:///content://) файлы готовы сразу.
  const isRemoteHttp = /^https?:\/\//i.test(remoteUri || '');
  const isVideoReady = !isVideo || !isRemoteHttp || dlState.cached;
  // Запрос на открытие полноэкранного режима, сделанный до того, как файл докачался —
  // как только докачка завершится, откроем плеер автоматически, без повторного нажатия.
  const pendingOpenRef = useRef(false);
  // Если нативный плеер сообщил об ошибке воспроизведения уже закэшированного файла
  // (чаще всего значит, что докачка завершилась, но файл на диске битый/неполный) —
  // перекачиваем файл заново автоматически, не заставляя пользователя разбираться самому.
  const [playbackError, setPlaybackError] = useState(false);
  const retriedAfterErrorRef = useRef(false);
  // Меняя этот ключ, заставляем React полностью пересоздать FullScreenVideoPlayer
  // (и, соответственно, его внутренний нативный плеер) — нужно, когда сам плеер
  // уже "развалился" (shared object released), а не файл в кэше битый, поэтому
  // перекачивать файл заново не нужно, достаточно создать новый плеер.
  const [playerInstanceKey, setPlayerInstanceKey] = useState(0);

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
    if (isVideo && !isStatic && isParentVisible && shouldPlay && isRemoteHttp) {
      startDownload(remoteUri, localFileUri, doneMarkerUri);
    }
  }, [remoteUri, isParentVisible, shouldPlay]);

  // Как только файл, запрошенный тапом по превью, полностью окажется в кэше —
  // открываем полноэкранный режим автоматически, без повторного нажатия.
  useEffect(() => {
    if (pendingOpenRef.current && dlState.cached && onFullScreen) {
      pendingOpenRef.current = false;
      onFullScreen(dlState.localUri || localUri, item.message_type || item.type);
    }
  }, [dlState.cached, dlState.localUri]);

  // Сбрасываем флаг "уже пробовали перекачать после ошибки" при каждой новой успешной
  // докачке, чтобы повторная ошибка в будущем (на новом файле) снова могла запустить retry.
  useEffect(() => {
    if (dlState.cached) retriedAfterErrorRef.current = false;
  }, [dlState.cached, dlState.localUri]);

  const handlePlaybackError = (err) => {
    const errMessage = String((err && (err.message || err)) || '');
    if (/released/i.test(errMessage)) {
      // Файл в кэше в порядке - "развалился" сам нативный объект плеера (гонка состояний,
      // например переключение источника/видимости ровно в момент нажатия play/pause).
      // Перекачивать нечего, достаточно пересоздать FullScreenVideoPlayer с нуля.
      console.log('[CachedMedia] player was released, recreating player instance:', remoteUri);
      setPlaybackError(false);
      setPlayerInstanceKey((k) => k + 1);
      return;
    }
    if (!isRemoteHttp) {
      // Файл и так локальный (не из кэша) — перекачивать нечего, просто сообщаем об ошибке.
      setPlaybackError(true);
      return;
    }
    if (retriedAfterErrorRef.current) {
      // Уже пробовали перекачать однажды и снова ошибка — скорее всего файл просто
      // несовместим (например, кодек), повторные попытки ничего не изменят.
      setPlaybackError(true);
      return;
    }
    retriedAfterErrorRef.current = true;
    setPlaybackError(false);
    console.log('[CachedMedia] playback error on cached file, re-downloading:', remoteUri);
    invalidateCache(remoteUri, localFileUri, doneMarkerUri).then(() => {
      startDownload(remoteUri, localFileUri, doneMarkerUri);
    });
  };

  // Проверяем при входе в чат (монтировании превью), скачано ли видео на телефон,
  // чтобы значок сразу показывал актуальный статус, а не "не скачано" по умолчанию
  useEffect(() => {
    if (!isVideo || !remoteUri) return;
    checkCached(remoteUri, localFileUri, doneMarkerUri);
  }, [remoteUri]);

  // Генерируем и кешируем статичный кадр видео для превью. Кадр берётся один раз с
  // удалённого/локального источника через expo-video-thumbnails (без запуска VideoPlayer),
  // поэтому это не приводит к OutOfMemoryError даже при большом числе видео в чате.
  // Сначала пробуем взять кадр с удалённого URL. Если это не получилось (часто для http-потока
  // нативный декодер не может читать файл), повторяем уже с докачанного локального файла,
  // когда видео попадёт в кэш.
  useEffect(() => {
    if (!isVideo || !remoteUri) return;
    let cancelled = false;
    const sourceUri = dlState.cached && dlState.localUri ? dlState.localUri : remoteUri;

    const loadThumbnail = async () => {
      try {
        const info = await getInfoAsync(thumbFileUri);
        if (info.exists) {
          if (!cancelled) setThumbUri(thumbFileUri);
          return;
        }
        const { uri } = await VideoThumbnails.getThumbnailAsync(sourceUri, { time: 0 });
        await copyAsync({ from: uri, to: thumbFileUri });
        if (!cancelled) setThumbUri(thumbFileUri);
      } catch (e) {
        if (sourceUri === remoteUri && isRemoteHttp) {
          console.log('[CachedMedia] remote thumbnail failed, will retry after caching:', e);
        } else {
          console.log('[CachedMedia] thumbnail generation error:', e);
        }
      }
    };

    loadThumbnail();
    return () => { cancelled = true; };
  }, [remoteUri, dlState.cached, dlState.localUri]);

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

  // Кнопка сохранения видео в постоянное хранилище (как для файлов в чате): доступна только
  // когда видео уже полностью скачано в кэш.
  const savableUri = isVideo && dlState.cached && dlState.localUri ? dlState.localUri : null;
  const handleSaveVideo = async () => {
    if (!savableUri || saving) return;
    setSaving(true);
    try {
      if (Platform.OS === 'android') {
        const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const base64 = await readAsStringAsync(savableUri, { encoding: EncodingType.Base64 });
          const newFileUri = await StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            fileName,
            'video/mp4'
          );
          await writeAsStringAsync(newFileUri, base64, { encoding: EncodingType.Base64 });
          Alert.alert('Успех', 'Видео сохранено');
        }
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(savableUri, { mimeType: 'video/mp4' });
      } else {
        Alert.alert('Ошибка', 'Функция "Поделиться" недоступна');
      }
    } catch (e) {
      console.error('[CachedMedia] save video error:', e);
      Alert.alert('Ошибка', 'Не удалось сохранить видео');
    } finally {
      setSaving(false);
    }
  };
  const insets = useSafeAreaInsets();
  const saveButtonTop = Math.max(insets.top, StatusBar.currentHeight || 0) + 10;
  const renderSaveButton = (top = 6, large = false) => (savableUri ? (
    <TouchableOpacity style={large ? [styles.saveButtonLarge, { top }] : [styles.saveButton, { top }]} onPress={handleSaveVideo} disabled={saving} activeOpacity={0.8}>
      {saving ? (
        <ActivityIndicator size={large ? 30 : 14} color="#fff" />
      ) : (
        large ? (
          <Ionicons name="save-outline" size={30} color="#fff" />
        ) : (
          <MaterialIcons name="save-alt" size={18} color="#fff" />
        )
      )}
    </TouchableOpacity>
  ) : null);

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
      // Видео ещё не докачано полностью — как и в ленте, не открываем полноэкранный режим сразу,
      // а запускаем/продолжаем докачку и запоминаем запрос на открытие — плеер откроется
      // сам по завершению докачки, без повторного нажатия.
      pendingOpenRef.current = true;
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
            открытии видео полноэкранно (ниже). Вместо этого показываем заранее сгенерированный
            и закешированный статичный кадр видео (thumbUri) через обычный Image. */}
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.thumbnailPlaceholder]} />
        )}
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
        {renderSaveButton()}
      </TouchableOpacity>
    );
  }

  // Fullscreen video player
  if (isVideo) {
    const { downloading, downloadedBytes, totalBytes } = dlState;
    return (
      <View style={[styles.thumbnailOuter, style]}>
        <View style={styles.thumbnailInner}>
          {playbackError ? (
            // Файл закэширован, но нативный плеер не смог его воспроизвести (битый файл
            // после докачки или несовместимый кодек) — автоматическая перекачка уже не
            // помогла, показываем понятное сообщение вместо вечного чёрного экрана.
            <View style={[StyleSheet.absoluteFill, styles.fullscreenWaitContainer]}>
              <MaterialIcons name="error-outline" size={36} color="rgba(255,255,255,0.7)" />
              <Text style={styles.playbackErrorText}>Не удалось воспроизвести видео</Text>
            </View>
          ) : isVideoReady ? (
            <FullScreenVideoPlayer
              key={playerInstanceKey}
              uri={dlState.cached && dlState.localUri ? dlState.localUri : remoteUri}
              isMuted={isMuted}
              isLooping={typeof isLooping === 'boolean' ? isLooping : !useNativeControls}
              shouldPlay={shouldPlay}
              style={StyleSheet.absoluteFill}
              controlsEnabled={!useNativeControls}
              resizeMode={resizeMode}
              onPlayerReady={onPlayerReady}
              onError={handlePlaybackError}
            />
          ) : (
            // Пока файл не докачан полностью — не создаём плеер с потоковым URL вообще, чтобы
            // видео не могло начать проигрываться и затем переключить источник на локальный
            // файл (именно это раньше вызывало видимый рестарт воспроизведения с начала).
            <View style={[StyleSheet.absoluteFill, styles.fullscreenWaitContainer]}>
              <ActivityIndicator size="large" color="#fff" />
            </View>
          )}
          {onFullScreen && useNativeControls && (
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
        {renderSaveButton(saveButtonTop, true)}
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
  saveButton: {
    position: 'absolute',
    top: 6,
    left: 6,
    zIndex: 11,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonLarge: {
    position: 'absolute',
    left: 12,
    zIndex: 11,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
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
  playbackErrorText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  fullscreenBytesText: {
    color: '#4FC3F7',
    fontSize: 9,
    fontWeight: '700',
  },
});

export default CachedMedia;
