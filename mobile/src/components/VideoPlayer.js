import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';

const VideoPlayer = ({ uri, isMuted = false, isLooping = false, shouldPlay = false, style }) => {
  return (
    <View style={[styles.container, style]}>
      <Video
        source={{ uri }}
        style={styles.video}
        resizeMode={ResizeMode.COVER}
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
