import React from 'react';
import { View, Text } from 'react-native';
import { CameraView } from 'expo-camera';
import { styles } from '../styles';

// Круглое превью камеры с таймером во время записи видеосообщения
export default function VideoRecordingOverlay({ cameraRef, timerSeconds }) {
  return (
    <View style={styles.videoPreviewOverlay}>
      <View style={styles.videoPreviewContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.videoPreview}
          facing="front"
          mode="video"
        />
        <View style={styles.videoRecordingTimerContainer}>
          <View style={styles.videoRecordingDot} />
          <Text style={styles.videoRecordingTimerText}>
            {Math.floor(timerSeconds / 60)}:{timerSeconds % 60 < 10 ? '0' : ''}{timerSeconds % 60}
          </Text>
        </View>
      </View>
    </View>
  );
}
