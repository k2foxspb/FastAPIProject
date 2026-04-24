import React, { useState, useEffect, useRef } from 'react';
import { getShadow } from '../utils/shadowStyles';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { Audio, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { cacheDirectory, getInfoAsync, downloadAsync, deleteAsync, readAsStringAsync, writeAsStringAsync, EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
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

export default function VoiceMessage({ item, currentUserId, isParentVisible = true }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [loading, setLoading] = useState(false);
  const [localUri, setLocalUri] = useState(null);
  const [playbackRate, setPlaybackRate] = useState(1);

  const remoteUri = resolveRemoteUri(item.file_path);
  const fileName = item.file_path.split('/').pop();
  const localFileUri = `${cacheDirectory}${fileName}`;

  const audioSource = localUri || remoteUri;
  const player = useAudioPlayer();
  const status = useAudioPlayerStatus(player);
  const playerSourceRef = useRef(null);

  useEffect(() => {
    if (audioSource && audioSource !== playerSourceRef.current) {
      playerSourceRef.current = audioSource;
      if (player.replaceAsync) {
        player.replaceAsync(audioSource).catch(e => console.log('[VoiceMessage] replaceAsync error:', e));
      } else {
        player.replace(audioSource);
      }
    }
  }, [audioSource, player]);

  useEffect(() => {
    if (!isParentVisible && player.playing) {
      player.pause();
    }
  }, [isParentVisible, player.playing]);

  useEffect(() => {
    if (player) {
      player.setPlaybackRate(playbackRate);
    }
  }, [playbackRate, player]);

  useEffect(() => {
    return () => {
      if (player) {
        try {
          player.pause();
        } catch (e) {}
      }
    };
  }, [player]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      setLoading(false);
      return;
    }
    const checkLocal = async () => {
      try {
        const fileInfo = await getInfoAsync(localFileUri);
        if (fileInfo.exists && fileInfo.size > 0) {
          setLocalUri(fileInfo.uri);
        } else if (fileInfo.exists && fileInfo.size === 0) {
          await deleteAsync(localFileUri, { idempotent: true });
        }
      } catch (e) {
        console.log('Error checking local audio file:', e);
      }
    };
    checkLocal();
  }, []);

  const loadAndPlay = async () => {
    if (player.playing) {
      player.pause();
      return;
    }

    // Ensure audio mode is set before playing
    await setPlaybackAudioMode();

    // Если аудио уже проиграно до конца, сбрасываем в начало перед повторным запуском
    if (status.currentTime >= (status.duration || 0) && (status.duration || 0) > 0) {
      player.seekTo(0);
    }

    if (!localUri && Platform.OS !== 'web') {
      setLoading(true);
      try {
        const fileInfo = await getInfoAsync(localFileUri);
        let uri = null;
        if (fileInfo.exists && fileInfo.size > 0) {
          uri = fileInfo.uri;
        } else {
          if (fileInfo.exists && fileInfo.size === 0) {
            await deleteAsync(localFileUri, { idempotent: true });
          }
          const downloadRes = await downloadAsync(remoteUri, localFileUri);
          if (downloadRes.status < 200 || downloadRes.status >= 300) {
            throw new Error(`Download failed with status ${downloadRes.status}`);
          }
          uri = downloadRes.uri;
        }
        setLocalUri(uri);
        if (player.replaceAsync) {
          await player.replaceAsync(uri);
        } else {
          player.replace(uri);
        }
      } catch (error) {
        console.error('Error loading voice message:', error);
        try {
          await deleteAsync(localFileUri, { idempotent: true });
        } catch (e) {}
      } finally {
        setLoading(false);
      }
    }

    try {
      await player.play();
    } catch (e) {
      console.log('[VoiceMessage] play error:', e);
      // Small fallback for race conditions
      setTimeout(() => {
        try { player.play(); } catch (_) {}
      }, 150);
    }
  };

  const handleDownload = async () => {
    if (Platform.OS === 'web') {
      try {
        // Simple download trigger for web
        const link = document.createElement('a');
        link.href = remoteUri;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (e) {
        console.log('Web download failed', e);
        // Fallback
        const win = window.open(remoteUri, '_blank');
        if (win) win.focus();
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
      console.error('Error sharing voice message:', error);
      Alert.alert('Ошибка', 'Не удалось скачать файл');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds) => {
    const totalSeconds = Math.floor(seconds || 0);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  };

  const position = status.currentTime || 0;
  const duration = status.duration || 0;
  const isPlaying = status.playing;
  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const isReceived = item.sender_id !== currentUserId;

  const togglePlaybackRate = () => {
    setPlaybackRate(prev => {
      if (prev === 1) return 1.5;
      if (prev === 1.5) return 2;
      return 1;
    });
  };

  return (
    <View style={[
      styles.container, 
      { 
        backgroundColor: isReceived ? colors.surface : colors.primary,
        ...getShadow('#000', { width: 0, height: 1 }, 0.1, 2, 1),
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

      <TouchableOpacity 
        onPress={togglePlaybackRate} 
        style={[styles.rateButton, { backgroundColor: isReceived ? colors.primary + '15' : 'rgba(255,255,255,0.2)' }]}
      >
        <Text style={[styles.rateText, { color: isReceived ? colors.primary : '#fff' }]}>
          {playbackRate}x
        </Text>
      </TouchableOpacity>

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
  rateButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 8,
    minWidth: 32,
    alignItems: 'center',
  },
  rateText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  downloadButton: {
    marginLeft: 10,
    padding: 5,
  },
});
