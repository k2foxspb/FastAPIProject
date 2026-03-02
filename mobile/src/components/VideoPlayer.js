import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
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
  const player = useVideoPlayer(uri, (p) => {
    p.loop = isLooping;
    p.muted = isMuted;
    if (shouldPlay) {
      p.play();
    }
  });

  const onPlayerReadyRef = useRef(onPlayerReady);

  useEffect(() => {
    onPlayerReadyRef.current = onPlayerReady;
  }, [onPlayerReady]);

  useEffect(() => {
    const fn = onPlayerReadyRef.current;
    if (typeof fn === 'function') {
      fn(player);
    }
  }, [player]);

  useEffect(() => {
    if (shouldPlay && !isMuted) {
      setPlaybackAudioMode();
    }
    if (shouldPlay) {
      player.play();
    } else {
      player.pause();
    }
  }, [shouldPlay, isMuted, player]);

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
