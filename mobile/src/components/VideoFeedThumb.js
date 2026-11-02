import React, { useState, useEffect } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { cacheDirectory, getInfoAsync, copyAsync } from 'expo-file-system/legacy';
import { Ionicons as Icon } from '@expo/vector-icons';
import { subscribe, checkCached, getState, startDownload } from '../utils/downloadManager';

// Нативный getThumbnailAsync для удалённого URL может не завершиться (ни resolve, ни reject) -
// тогда превью навсегда остаётся пустым. Ограничиваем ожидание, чтобы уйти на докачку.
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('thumbnail timeout')), ms);
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (err) => { clearTimeout(timer); reject(err); }
  );
});

// Превью видео в ленте: та же логика, что в CachedMedia - общий кэш загрузок, кадр из кэша
// и повтор генерации кадра с докачанного локального файла (без запуска новых загрузок)
const VideoFeedThumb = ({ uri, style }) => {
  const fileName = uri.split('/').pop().split('?')[0];
  const localFileUri = `${cacheDirectory}${fileName}`;
  const doneMarkerUri = `${localFileUri}.done`;
  const thumbFileUri = `${cacheDirectory}thumb_${fileName}.jpg`;
  const isRemoteHttp = /^https?:\/\//i.test(uri || '');
  const [thumbUri, setThumbUri] = useState(null);
  const [dlState, setDlState] = useState(() => getState(uri));

  useEffect(() => {
    const unsub = subscribe(uri, (state) => setDlState(state));
    return unsub;
  }, [uri]);

  useEffect(() => {
    checkCached(uri, localFileUri, doneMarkerUri);
  }, [uri]);

  useEffect(() => {
    let cancelled = false;
    const sourceUri = dlState.cached && dlState.localUri ? dlState.localUri : uri;

    const loadThumbnail = async () => {
      try {
        const info = await getInfoAsync(thumbFileUri);
        if (info.exists) {
          if (!cancelled) setThumbUri(thumbFileUri);
          return;
        }
        console.log('[VideoFeedThumb][TEMP] getThumbnailAsync start:', sourceUri);
        const { uri: frame } = await withTimeout(VideoThumbnails.getThumbnailAsync(sourceUri, { time: 0 }), 10000);
        console.log('[VideoFeedThumb][TEMP] getThumbnailAsync resolved:', frame);
        await copyAsync({ from: frame, to: thumbFileUri });
        if (!cancelled) setThumbUri(thumbFileUri);
      } catch (e) {
        console.log('[VideoFeedThumb][TEMP] thumb rejected:', { sourceUri, isRemoteHttp, error: String(e && (e.message || e)) });
        if (sourceUri === uri && isRemoteHttp) {
          // Как и в CachedMedia - если кадр не удалось снять прямо с удалённого потока,
          // запускаем докачку в фон, чтобы эффект перезапустился на локальном файле
          // и миниатюра появилась сама, без необходимости открывать видео.
          console.log('[VideoFeedThumb] remote thumbnail failed, starting background download for retry:', e);
          startDownload(uri, localFileUri, doneMarkerUri);
        } else {
          console.log('[VideoFeedThumb] video thumbnail error:', e);
        }
      }
    };

    loadThumbnail();
    return () => { cancelled = true; };
  }, [uri, dlState.cached, dlState.localUri]);

  return (
    <View style={[style, { backgroundColor: '#000', overflow: 'hidden' }]}>
      {thumbUri ? <Image source={{ uri: thumbUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Icon name="play-circle" size={28} color="#fff" />
      </View>
    </View>
  );
};

export default VideoFeedThumb;
