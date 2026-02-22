import React, { useState, useEffect } from 'react';
import { View, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { cacheDirectory, getInfoAsync, downloadAsync } from 'expo-file-system/legacy';
import { API_BASE_URL } from '../constants';
import VideoPlayer from './VideoPlayer';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

const CachedMedia = ({ item, onFullScreen, style, resizeMode = "cover", useNativeControls = false, shouldPlay = true, isMuted = true }) => {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [localUri, setLocalUri] = useState(null);
  const [loading, setLoading] = useState(true);

  const remoteUri = (item.file_path && (item.file_path.startsWith('http') || item.file_path.startsWith('file://') || item.file_path.startsWith('content://'))) ? item.file_path : (item.file_path ? `${API_BASE_URL}${item.file_path}` : '');
  const fileName = item.file_path ? item.file_path.split('/').pop() : 'unknown';
  const localFileUri = `${cacheDirectory}${fileName}`;

  useEffect(() => {
    if (!item.file_path) {
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
      <View style={[styles.loaderContainer, style || { backgroundColor: colors.surface }]}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  const isVideo = item.message_type === 'video' || item.type === 'video';

  return (
    <View style={style}>
      {isVideo ? (
        <View style={style || styles.thumbnail}>
          <VideoPlayer 
            uri={localUri} 
            isMuted={isMuted} 
            isLooping={!useNativeControls} 
            shouldPlay={shouldPlay} 
            style={StyleSheet.absoluteFill}
            useNativeControls={useNativeControls}
            resizeMode={resizeMode}
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
          style={style || styles.thumbnail}
        >
          <Image 
            source={{ uri: localUri }} 
            style={StyleSheet.absoluteFill} 
            resizeMode={resizeMode}
          />
        </TouchableOpacity>
      )}
    </View>
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
  },
});

export default CachedMedia;
