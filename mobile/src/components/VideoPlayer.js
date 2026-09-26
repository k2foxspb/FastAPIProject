import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { setPlaybackAudioMode } from '../utils/audioSettings';

const VideoPlayer = ({
  uri,
  isMuted = false,
  isLooping = false,
  shouldPlay = false,
  style,
  useNativeControls = false,
  resizeMode = 'cover',
  onPlayerReady,
}) => {
  const shouldPlayRef = useRef(shouldPlay);
  shouldPlayRef.current = shouldPlay;

  const player = useVideoPlayer(uri, (p) => {
    p.loop = isLooping;
    p.muted = isMuted;
    // Don't call play() here — wait for statusChange readyToPlay
  });

  // Sync muted
  useEffect(() => {
    try { player.muted = isMuted; } catch (e) {}
  }, [isMuted, player]);

  // Sync loop
  useEffect(() => {
    try { player.loop = isLooping; } catch (e) {}
  }, [isLooping, player]);

  // Sync play/pause when shouldPlay changes
  useEffect(() => {
    if (shouldPlay) {
      setPlaybackAudioMode().finally(() => {
        try { player.play(); } catch (e) {}
      });
    } else {
      try { player.pause(); } catch (e) {}
    }
  }, [shouldPlay, player]);

  // Позиция воспроизведения, которую нужно восстановить после замены источника
  // (например, когда видео докачалось и поток переключается на локальный файл).
  // Хранится в ref до тех пор, пока её не подтвердит player.status === 'readyToPlay' —
  // единственный документированный у expo-video сигнал того, что буферизовано достаточно
  // данных для воспроизведения. Событие sourceLoad для этого НЕ подходит: по документации
  // оно означает только то, что загружены метаданные источника, и явно не гарантирует
  // готовность данных к playback — присвоение currentTime в этот момент может быть молча
  // проигнорировано нативной стороной, поэтому раньше это приводило к потере позиции
  // (ref сбрасывался в sourceLoad раньше, чем readyToPlay успевал применить её по-настоящему).
  const pendingResumeTimeRef = useRef(null);

  // Ранняя, не гарантированная попытка восстановить позицию сразу после замены источника.
  // Не очищает pendingResumeTimeRef — если присвоение будет проигнорировано плеером,
  // confirmSourceReady ниже повторит и подтвердит попытку, когда источник точно готов.
  const tryApplyPendingResumeTime = () => {
    const resumeTime = pendingResumeTimeRef.current;
    if (resumeTime !== null && resumeTime > 0) {
      try { player.currentTime = resumeTime; } catch (e) {}
    }
  };

  // Финальное (подтверждённое) применение позиции и запуск воспроизведения при необходимости.
  // Вызывается только когда player.status действительно 'readyToPlay' — только тогда ref
  // окончательно очищается, чтобы не потерять отложенную позицию из-за недостоверной попытки.
  const confirmSourceReady = () => {
    const resumeTime = pendingResumeTimeRef.current;
    if (resumeTime !== null) {
      pendingResumeTimeRef.current = null;
      try { if (resumeTime > 0) player.currentTime = resumeTime; } catch (e) {}
    }
    if (shouldPlayRef.current) {
      setPlaybackAudioMode().finally(() => {
        try { player.play(); } catch (e) {}
      });
    }
  };

  // Handle uri change
  const playerSourceRef = useRef(uri);
  useEffect(() => {
    if (uri && uri !== playerSourceRef.current) {
      playerSourceRef.current = uri;
      // Запоминаем текущую позицию воспроизведения, чтобы продолжить с того же места
      // после замены источника (например, когда видео докачалось и поток переключается на локальный файл)
      let resumeTime = 0;
      try { resumeTime = player.currentTime || 0; } catch (e) {}
      pendingResumeTimeRef.current = resumeTime;

      const resumePlayback = () => {
        tryApplyPendingResumeTime();
        // Если плеер уже сообщает readyToPlay прямо сейчас (например, локальный файл открылся
        // мгновенно и статус не будет меняться отдельным событием) — подтверждаем позицию и
        // запускаем воспроизведение сразу. Иначе play() здесь НЕ вызываем: старт мог бы случиться
        // с ещё не восстановленной позицией — ждём надёжного события readyToPlay ниже.
        if (player.status === 'readyToPlay') {
          confirmSourceReady();
        }
      };

      try {
        if (player.replaceAsync) {
          player.replaceAsync(uri).then(resumePlayback).catch(err => console.log('[VideoPlayer] replaceAsync error:', err));
        } else {
          player.replace(uri);
          resumePlayback();
        }
      } catch (e) {
        console.log('[VideoPlayer] replace error:', e);
      }
    }
  }, [uri, player]);

  // Status listener — play when ready if shouldPlay.
  // readyToPlay — единственный надёжный сигнал того, что плеер загрузил достаточно данных для
  // воспроизведения (см. документацию expo-video), поэтому именно здесь подтверждается
  // отложенная позиция и запускается play(). confirmSourceReady идемпотентна, поэтому повторный
  // вызов (например, если позиция уже была подтверждена в resumePlayback выше) безопасен.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && shouldPlayRef.current) {
        confirmSourceReady();
      }
    });
    return () => sub.remove();
  }, [player]);

  // onPlayerReady callback
  const playerReadyCalledRef = useRef(null);
  useEffect(() => {
    if (typeof onPlayerReady === 'function' && playerReadyCalledRef.current !== player) {
      playerReadyCalledRef.current = player;
      onPlayerReady(player);
    }
  }, [onPlayerReady, player]);

  return (
    <View style={[styles.container, style]}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit={resizeMode === 'contain' ? 'contain' : (resizeMode === 'stretch' ? 'fill' : 'cover')}
        nativeControls={useNativeControls}
        surfaceType="textureView"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: '100%',
  },
});

export default VideoPlayer;
