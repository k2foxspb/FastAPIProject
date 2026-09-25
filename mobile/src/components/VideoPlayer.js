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
  // Хранится в ref, чтобы её мог применить тот слушатель, который сработает первым —
  // либо промис replaceAsync, либо событие statusChange('readyToPlay') —
  // и видео не успевало "прыгнуть" на начало перед восстановлением позиции.
  const pendingResumeTimeRef = useRef(null);

  const applyPendingResumeTime = () => {
    const resumeTime = pendingResumeTimeRef.current;
    if (resumeTime !== null) {
      pendingResumeTimeRef.current = null;
      try { if (resumeTime > 0) player.currentTime = resumeTime; } catch (e) {}
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
        applyPendingResumeTime();
        if (shouldPlayRef.current) {
          setPlaybackAudioMode().finally(() => {
            try { player.play(); } catch (e) {}
          });
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

  // Status listener — play when ready if shouldPlay
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && shouldPlayRef.current) {
        // Если к этому моменту позиция ещё не восстановлена (гонка с промисом replaceAsync),
        // применяем её прямо здесь — до старта воспроизведения, чтобы избежать видимого рестарта с начала.
        applyPendingResumeTime();
        setPlaybackAudioMode().finally(() => {
          try { player.play(); } catch (e) {}
        });
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
