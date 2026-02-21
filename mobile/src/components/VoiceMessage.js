import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { Audio } from 'expo-av';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { cacheDirectory, getInfoAsync, downloadAsync, readAsStringAsync, writeAsStringAsync, EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { API_BASE_URL } from '../constants';
import { setPlaybackAudioMode } from '../utils/audioSettings';

const resolveRemoteUri = (path) => {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = API_BASE_URL.replace(/\/+$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}`;
};

export default function VoiceMessage({ item, currentUserId }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [loading, setLoading] = useState(false);
  const [localUri, setLocalUri] = useState(null);

  const remoteUri = resolveRemoteUri(item.file_path);
  const fileName = item.file_path.split('/').pop();
  const localFileUri = `${cacheDirectory}${fileName}`;

  useEffect(() => {
    return sound ? () => { sound.unloadAsync(); } : undefined;
  }, [sound]);

  const loadAndPlay = async () => {
    // Устанавливаем режим аудио с прерыванием других приложений
    await setPlaybackAudioMode();

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
        const fileInfo = await getInfoAsync(localFileUri);
        if (fileInfo.exists) {
          uri = fileInfo.uri;
        } else {
          const downloadRes = await downloadAsync(remoteUri, localFileUri);
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

  const handleDownload = async () => {
    setLoading(true);
    try {
      let uri = localUri;
      if (!uri) {
        const fileInfo = await getInfoAsync(localFileUri);
        if (fileInfo.exists) {
          uri = fileInfo.uri;
        } else {
          const downloadRes = await downloadAsync(remoteUri, localFileUri);
          uri = downloadRes.uri;
        }
        setLocalUri(uri);
      }

      if (Platform.OS === 'android') {
        const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
          const newFileUri = await StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            fileName,
            'audio/m4a'
          );
          await writeAsStringAsync(newFileUri, base64, { encoding: EncodingType.Base64 });
          Alert.alert('Успех', 'Голосовое сообщение сохранено');
        }
      } else {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri);
        } else {
          Alert.alert('Ошибка', 'Функция "Поделиться" недоступна');
        }
      }
    } catch (error) {
      console.error('Error downloading voice message:', error);
      Alert.alert('Ошибка', 'Не удалось сохранить файл');
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    setLoading(true);
    try {
      let uri = localUri;
      if (!uri) {
        const fileInfo = await getInfoAsync(localFileUri);
        if (fileInfo.exists) {
          uri = fileInfo.uri;
        } else {
          const downloadRes = await downloadAsync(remoteUri, localFileUri);
          uri = downloadRes.uri;
        }
        setLocalUri(uri);
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('Ошибка', 'Функция "Поделиться" недоступна');
      }
    } catch (error) {
      console.error('Error sharing voice message:', error);
      Alert.alert('Ошибка', 'Не удалось скачать файл');
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
    <View style={[
      styles.container,
      { 
        backgroundColor: isReceived ? colors.surface : colors.primary,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 1,
      }
    ]}>
      <TouchableOpacity onPress={loadAndPlay} disabled={loading} style={styles.playButton}>
        <View style={[styles.playIconContainer, { backgroundColor: isReceived ? colors.primary + '15' : 'rgba(255,255,255,0.2)' }]}>
          {loading ? (
            <ActivityIndicator size="small" color={isReceived ? colors.primary : "#fff"} />
          ) : (
            <MaterialIcons 
              name={isPlaying ? "pause" : "play-arrow"} 
              size={28} 
              color={isReceived ? colors.primary : "#fff"} 
            />
          )}
        </View>
      </TouchableOpacity>
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { backgroundColor: isReceived ? colors.border : 'rgba(255,255,255,0.3)' }]}>
          <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: isReceived ? colors.primary : "#fff" }]} />
        </View>
        <View style={styles.timeContainer}>
          <Text style={[styles.timeText, { color: isReceived ? colors.textSecondary : 'rgba(255,255,255,0.8)' }]}>
            {formatTime(position)} / {formatTime(duration)}
          </Text>
        </View>
      </View>
      <TouchableOpacity onPress={handleDownload} disabled={loading} style={styles.downloadButton}>
        <MaterialIcons 
          name="file-download" 
          size={20} 
          color={isReceived ? colors.textSecondary : 'rgba(255,255,255,0.8)'} 
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 16,
    minWidth: 220,
    marginVertical: 2,
  },
  playButton: {
    marginRight: 12,
  },
  playIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
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
  downloadButton: {
    marginLeft: 10,
    padding: 5,
  },
});
