import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { setPlaybackAudioMode } from '../utils/audioSettings';

const VideoPlayer = ({ uri, isMuted = false, isLooping = false, shouldPlay = false, style, useNativeControls = false, resizeMode = ResizeMode.COVER }) => {
  useEffect(() => {
    if (shouldPlay && !isMuted) {
      setPlaybackAudioMode();
    }
  }, [shouldPlay, isMuted]);

  return (
    <View style={[styles.container, style]}>
      <Video
        source={{ uri }}
        style={styles.video}
        resizeMode={resizeMode}
        useNativeControls={useNativeControls}
        isMuted={isMuted}
        isLooping={isLooping}
        shouldPlay={shouldPlay}
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
