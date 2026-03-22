import React, { useEffect, useRef, useState } from 'react';
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
  const [playerStatus, setPlayerStatus] = useState('idle');
  const onPlayerReadyRef = useRef(onPlayerReady);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = isLooping;
    p.muted = isMuted;
    if (shouldPlay) {
      p.play();
    }
  });

  const lastUriRef = useRef(uri);

  useEffect(() => {
    if (uri && uri !== lastUriRef.current) {
      player.replaceAsync(uri).catch(err => console.log('[VideoPlayer] replaceAsync error:', err));
      lastUriRef.current = uri;
    }
  }, [uri, player]);

  useEffect(() => {
    if (shouldPlay) {
      if (!isMuted) setPlaybackAudioMode();
      player.play();
    } else {
      player.pause();
    }
  }, [shouldPlay, player, isMuted]);

  useEffect(() => {
    onPlayerReadyRef.current = onPlayerReady;
  }, [onPlayerReady]);

  useEffect(() => {
    const fn = onPlayerReadyRef.current;
    if (typeof fn === 'function') {
      fn(player);
    }
    
    const sub = player.addListener('statusChange', (payload) => {
      setPlayerStatus(payload.status);
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    return () => {
      if (player) {
        try {
          player.pause();
          player.release?.();
        } catch (e) {}
      }
    };
  }, [player]);

  useEffect(() => {
    player.muted = isMuted;
  }, [isMuted, player]);

  useEffect(() => {
    player.loop = isLooping;
  }, [isLooping, player]);

  return (
    <View style={[styles.container, style]}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit={resizeMode === 'contain' ? 'contain' : (resizeMode === 'stretch' ? 'fill' : 'cover')}
        nativeControls={useNativeControls}
      />
      {(playerStatus === 'loading' || playerStatus === 'idle') && (
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}>
          <ActivityIndicator size={style?.height > 100 ? "large" : "small"} color="#fff" />
        </View>
      )}
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
