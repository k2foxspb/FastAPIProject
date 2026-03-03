import React, { useState, useEffect } from 'react';
import { View, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { cacheDirectory, getInfoAsync, downloadAsync } from 'expo-file-system/legacy';
import { API_BASE_URL } from '../constants';
import VideoPlayer from './VideoPlayer';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

const CachedMedia = ({ item, onFullScreen, style, resizeMode = "cover", useNativeControls = false, shouldPlay = true, isMuted = true, onPlayerReady, isLooping, isStatic = false }) => {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [localUri, setLocalUri] = useState(null);
  const [loading, setLoading] = useState(true);

  const isVideo = item.message_type === 'video' || item.type === 'video';
  const remoteUri = (item.file_path && (item.file_path.startsWith('http') || item.file_path.startsWith('file://') || item.file_path.startsWith('content://'))) ? item.file_path : (item.file_path ? `${API_BASE_URL}${item.file_path}` : '');
  const fileName = item.file_path ? item.file_path.split('/').pop() : 'unknown';
  const localFileUri = `${cacheDirectory}${fileName}`;

  useEffect(() => {
    if (!item.file_path) {
      setLoading(false);
      return;
    }

    if (Platform.OS === 'web') {
      setLocalUri(remoteUri);
      setLoading(false);
      return;
    }

    const loadMedia = async () => {
      try {
        if (item.file_path && (item.file_path.startsWith('file://') || item.file_path.startsWith('content://'))) {
          setLocalUri(item.file_path);
          setLoading(false);
          return;
        }

        const fileInfo = await getInfoAsync(localFileUri);
        if (fileInfo.exists) {
          setLocalUri(fileInfo.uri);
          setLoading(false);
        } else {
          // Download and cache
          const downloadRes = await downloadAsync(remoteUri, localFileUri);
          setLocalUri(downloadRes.uri);
          setLoading(false);
        }
      } catch (error) {
        console.error('Error loading/caching media:', error);
        setLocalUri(remoteUri); // Fallback to remote if cache fails
        setLoading(false);
      }
    };

    loadMedia();
  }, [item.file_path]);

  if (loading) {
    return (
      <View style={[
        styles.loaderContainer, 
        style,
        { backgroundColor: isVideo ? '#000' : (style?.backgroundColor || colors.surface) }
      ]}>
        <ActivityIndicator size={isVideo ? "large" : "small"} color={isVideo ? "#fff" : colors.primary} />
      </View>
    );
  }

  if (isVideo && isStatic) {
    return (
      <TouchableOpacity
        onPress={() => onFullScreen && onFullScreen(localUri, item.message_type || item.type)}
        style={[styles.thumbnail, style]}
      >
        <Image
          source={{ uri: localUri }}
          style={StyleSheet.absoluteFill}
          resizeMode={resizeMode}
        />
        <View style={styles.playOverlay}>
          <View style={styles.playButtonCircle}>
            <MaterialIcons name="play-arrow" size={32} color="#fff" />
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return isVideo ? (
    <View style={[styles.thumbnail, style]}>
      <VideoPlayer 
        uri={localUri} 
        isMuted={isMuted} 
        isLooping={typeof isLooping === 'boolean' ? isLooping : !useNativeControls} 
        shouldPlay={shouldPlay} 
        style={StyleSheet.absoluteFill}
        useNativeControls={useNativeControls}
        resizeMode={resizeMode}
        onPlayerReady={onPlayerReady}
      />
      {onFullScreen && (
        <TouchableOpacity 
          style={StyleSheet.absoluteFill} 
          onPress={() => onFullScreen(localUri, item.message_type || item.type)}
        />
      )}
    </View>
  ) : (
    <TouchableOpacity 
      disabled={!onFullScreen} 
      onPress={() => onFullScreen && onFullScreen(localUri, item.message_type || item.type)}
      style={[styles.thumbnail, style]}
    >
      <Image 
        source={{ uri: localUri }} 
        style={StyleSheet.absoluteFill} 
        resizeMode={resizeMode}
      />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  loaderContainer: {
    width: 200,
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
  },
  thumbnail: {
    width: 200,
    height: 150,
    borderRadius: 14,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  playButtonCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
});

export default CachedMedia;
