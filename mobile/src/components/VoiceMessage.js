import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Audio } from 'expo-av';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE_URL } from '../constants';

export default function VoiceMessage({ item, currentUserId }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [loading, setLoading] = useState(false);
  const [localUri, setLocalUri] = useState(null);

  const remoteUri = `${API_BASE_URL}${item.file_path}`;
  const fileName = item.file_path.split('/').pop();
  const localFileUri = `${FileSystem.cacheDirectory}${fileName}`;

  useEffect(() => {
    return sound ? () => { sound.unloadAsync(); } : undefined;
  }, [sound]);

  const loadAndPlay = async () => {
    if (sound) {
      if (isPlaying) {
        await sound.pauseAsync();
      } else {
        await sound.playAsync();
      }
      return;
    }

    setLoading(true);
    try {
      let uri = localUri;
      if (!uri) {
        const fileInfo = await FileSystem.getInfoAsync(localFileUri);
        if (fileInfo.exists) {
          uri = fileInfo.uri;
        } else {
          const downloadRes = await FileSystem.downloadAsync(remoteUri, localFileUri);
          uri = downloadRes.uri;
        }
        setLocalUri(uri);
      }

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true },
        onPlaybackStatusUpdate
      );
      setSound(newSound);
    } catch (error) {
      console.error('Error playing voice message:', error);
    } finally {
      setLoading(false);
    }
  };

  const onPlaybackStatusUpdate = (status) => {
    if (status.isLoaded) {
      setPosition(status.positionMillis);
      setDuration(status.durationMillis);
      setIsPlaying(status.isPlaying);
      if (status.didJustFinish) {
        setIsPlaying(false);
        setPosition(0);
      }
    }
  };

  const formatTime = (millis) => {
    const totalSeconds = millis / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const isReceived = item.sender_id !== currentUserId;

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={loadAndPlay} disabled={loading} style={styles.playButton}>
        {loading ? (
          <ActivityIndicator size="small" color={isReceived ? colors.primary : "#fff"} />
        ) : (
          <MaterialIcons 
            name={isPlaying ? "pause" : "play-arrow"} 
            size={32} 
            color={isReceived ? colors.primary : "#fff"} 
          />
        )}
      </TouchableOpacity>
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { backgroundColor: isReceived ? colors.border : 'rgba(255,255,255,0.3)' }]}>
          <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: isReceived ? colors.primary : "#fff" }]} />
        </View>
        <View style={styles.timeContainer}>
          <Text style={[styles.timeText, { color: isReceived ? colors.textSecondary : 'rgba(255,255,255,0.7)' }]}>
            {formatTime(position)} / {formatTime(duration)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    minWidth: 200,
  },
  playButton: {
    marginRight: 10,
  },
  progressContainer: {
    flex: 1,
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    width: '100%',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  timeContainer: {
    marginTop: 4,
  },
  timeText: {
    fontSize: 10,
  },
});
