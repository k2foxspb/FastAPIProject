import React, { useState, useEffect } from 'react';
import { View, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE_URL } from '../constants';
import VideoPlayer from './VideoPlayer';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

const CachedMedia = ({ item, onFullScreen }) => {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [localUri, setLocalUri] = useState(null);
  const [loading, setLoading] = useState(true);

  const remoteUri = `${API_BASE_URL}${item.file_path}`;
  const fileName = item.file_path.split('/').pop();
  const localFileUri = `${FileSystem.cacheDirectory}${fileName}`;

  useEffect(() => {
    const loadMedia = async () => {
      try {
        const fileInfo = await FileSystem.getInfoAsync(localFileUri);
        if (fileInfo.exists) {
          setLocalUri(fileInfo.uri);
          setLoading(false);
        } else {
          // Download and cache
          const downloadRes = await FileSystem.downloadAsync(remoteUri, localFileUri);
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
      <View style={[styles.loaderContainer, { backgroundColor: colors.surface }]}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  const isVideo = item.message_type === 'video';

  return (
    <TouchableOpacity onPress={() => onFullScreen(localUri, item.message_type)}>
      {isVideo ? (
        <VideoPlayer uri={localUri} isMuted={true} isLooping={true} shouldPlay={true} />
      ) : (
        <Image source={{ uri: localUri }} style={styles.thumbnail} />
      )}
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
  },
});

export default CachedMedia;
