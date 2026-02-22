import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { setPlaybackAudioMode } from '../utils/audioSettings';

const VideoPlayer = ({ uri, isMuted = false, isLooping = false, shouldPlay = false, style, useNativeControls = false, resizeMode = 'cover' }) => {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = isLooping;
    p.muted = isMuted;
    if (shouldPlay) {
      p.play();
    }
  });

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
    width: 200,
    height: 150,
    backgroundColor: '#000',
    borderRadius: 14,
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: '100%',
  },
});

export default VideoPlayer;
