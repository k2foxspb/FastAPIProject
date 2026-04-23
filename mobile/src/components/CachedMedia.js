import React, { useState, useEffect, useRef } from 'react';
import { View, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Text, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { cacheDirectory, getInfoAsync, deleteAsync, createDownloadResumable } from 'expo-file-system/legacy';
import { API_BASE_URL } from '../constants';
import VideoPlayer from './VideoPlayer';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

const STALL_TIMEOUT_MS = 3000;

const formatBytes = (bytes) => {
  if (!bytes || bytes <= 0) return '0 КБ';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${Math.round(bytes / 1024)} КБ`;
};

const CachedMedia = ({ item, onFullScreen, style, resizeMode = "cover", useNativeControls = false, shouldPlay = true, isMuted = true, onPlayerReady, isLooping, isStatic = false, isParentVisible = true, onDownloadProgress }) => {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [localUri, setLocalUri] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [isStalled, setIsStalled] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const stallTimerRef = useRef(null);
  const lastBytesRef = useRef(0);
  const downloadResumableRef = useRef(null);

  const isVideo = item.message_type === 'video' || item.type === 'video';
  const remoteUri = (item.file_path && (item.file_path.startsWith('http') || item.file_path.startsWith('file://') || item.file_path.startsWith('content://'))) ? item.file_path : (item.file_path ? `${API_BASE_URL}${item.file_path}` : '');
  const fileName = item.file_path ? item.file_path.split('/').pop() : 'unknown';
  const localFileUri = `${cacheDirectory}${fileName}`;

  const resetStallTimer = (loaded) => {
    if (loaded !== lastBytesRef.current) {
      // Bytes are progressing — clear stall state and timer
      lastBytesRef.current = loaded;
      setIsStalled(false);
      if (stallTimerRef.current) {
        clearTimeout(stallTimerRef.current);
        stallTimerRef.current = null;
      }
    } else if (loaded > 0 && !stallTimerRef.current) {
      // Bytes haven't changed — start stall timer if not already running
      stallTimerRef.current = setTimeout(() => setIsStalled(true), STALL_TIMEOUT_MS);
    }
  };

  useEffect(() => {
    return () => {
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    };
  }, []);

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

    if (item.file_path.startsWith('file://') || item.file_path.startsWith('content://')) {
      setLocalUri(item.file_path);
      setLoading(false);
      return;
    }

    const loadMedia = async () => {
      try {
        const fileInfo = await getInfoAsync(localFileUri);
        if (fileInfo.exists && fileInfo.size > 0) {
          setLocalUri(fileInfo.uri);
          setLoading(false);
          return;
        }

        // If file exists but is empty, delete it
        if (fileInfo.exists && fileInfo.size === 0) {
          try {
            await deleteAsync(localFileUri, { idempotent: true });
          } catch (e) {
            console.warn('Failed to delete empty file:', e);
          }
        }

        if (isVideo) {
          // For video: just set remote URI, do NOT auto-download — wait for user tap
          setLocalUri(remoteUri);
          setLoading(false);
        } else {
          // For images: download first (fast), then show
          const downloadResumable = createDownloadResumable(remoteUri, localFileUri, {}, (progress) => {
            const { totalBytesWritten, totalBytesExpectedToWrite } = progress;
            setDownloadedBytes(totalBytesWritten);
            setTotalBytes(totalBytesExpectedToWrite);
            resetStallTimer(totalBytesWritten);
          });
          const downloadRes = await downloadResumable.downloadAsync();
          if (!downloadRes || downloadRes.status < 200 || downloadRes.status >= 300) {
            throw new Error(`Download failed with status ${downloadRes?.status}`);
          }
          setLocalUri(downloadRes.uri);
          setLoading(false);
        }
      } catch (error) {
        console.error('Error loading/caching media:', error);
        try {
          await deleteAsync(localFileUri, { idempotent: true });
        } catch (e) {}
        setLocalUri(remoteUri);
        setLoading(false);
      }
    };

    loadMedia();
  }, [item.file_path]);

  const downloadFileBackground = async (remote, local) => {
    setDownloading(true);
    setDownloadedBytes(0);
    setTotalBytes(0);
    setIsStalled(false);
    lastBytesRef.current = 0;
    if (onDownloadProgress) onDownloadProgress(0, 0, false);
    const MAX_RETRIES = 3;
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      try {
        // Delete partial file before each attempt
        try { await deleteAsync(local, { idempotent: true }); } catch (_) {}
        const resumable = createDownloadResumable(remote, local, {}, (progress) => {
          const { totalBytesWritten, totalBytesExpectedToWrite } = progress;
          setDownloadedBytes(totalBytesWritten);
          setTotalBytes(totalBytesExpectedToWrite);
          resetStallTimer(totalBytesWritten);
          if (onDownloadProgress) onDownloadProgress(totalBytesWritten, totalBytesExpectedToWrite, isStalled);
        });
        downloadResumableRef.current = resumable;

        const result = await resumable.downloadAsync();
        if (result && result.uri) {
          setLocalUri(result.uri);
          setIsStalled(false);
          if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
        }
        // Success — exit loop
        break;
      } catch (e) {
        attempt += 1;
        const isRefused = e?.message && (e.message.includes('REFUSED_STREAM') || e.message.includes('stream was reset'));
        if (isRefused && attempt < MAX_RETRIES) {
          // Brief delay before retry (exponential backoff: 1s, 2s)
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          setDownloadedBytes(0);
          setTotalBytes(0);
          lastBytesRef.current = 0;
          setIsStalled(false);
        } else {
          console.warn('[CachedMedia] background download failed:', e);
          break;
        }
      }
    }
    downloadResumableRef.current = null;
    setDownloading(false);
    setIsStalled(false);
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
    if (onDownloadProgress) onDownloadProgress(-1, 0, false);
  };

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

  if (isVideo && (!isParentVisible || isStatic || !shouldPlay)) {
    const handleVideoTap = () => {
      if (onFullScreen) {
        onFullScreen(localUri, item.message_type || item.type);
        // Start background cache download after user opens the video
        if (localUri && localUri.startsWith('http')) {
          downloadFileBackground(localUri, localFileUri);
        }
      }
    };
    return (
      <TouchableOpacity
        onPress={handleVideoTap}
        style={[styles.thumbnail, style]}
        activeOpacity={0.85}
      >
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }]}>
          <MaterialIcons name="videocam" size={40} color="rgba(255,255,255,0.3)" />
        </View>
        <View style={styles.playOverlay}>
          <View style={styles.playButtonCircle}>
            <MaterialIcons name="play-arrow" size={32} color="#fff" />
          </View>
        </View>
        {(downloading || downloadedBytes > 0) && (
          <View style={styles.downloadBadge} pointerEvents="none">
            {downloadedBytes > 0 ? (
              <Text style={styles.downloadBytesText}>
                {totalBytes > 0
                  ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
                  : formatBytes(downloadedBytes)}
              </Text>
            ) : (
              <Text style={styles.downloadBytesText}>загрузка…</Text>
            )}
            {totalBytes > 0 && downloadedBytes > 0 && (
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${Math.min(downloadedBytes / totalBytes, 1) * 100}%` }]} />
              </View>
            )}
            {isStalled && <Text style={styles.stallSubText}>медленное соединение…</Text>}
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return isVideo ? (
    <View style={[styles.thumbnailOuter, style]}>
      <View style={styles.thumbnailInner}>
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
      {(downloading || downloadedBytes > 0) && (
        <View style={styles.downloadBadge} pointerEvents="none">
          {downloadedBytes > 0 ? (
            <Text style={styles.downloadBytesText}>
              {totalBytes > 0
                ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
                : formatBytes(downloadedBytes)}
            </Text>
          ) : (
            <Text style={styles.downloadBytesText}>загрузка…</Text>
          )}
          {totalBytes > 0 && downloadedBytes > 0 && (
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${Math.min(downloadedBytes / totalBytes, 1) * 100}%` }]} />
            </View>
          )}
          {isStalled && <Text style={styles.stallSubText}>медленное соединение…</Text>}
        </View>
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
  thumbnailOuter: {
    width: 200,
    height: 150,
    borderRadius: 14,
    backgroundColor: '#000',
  },
  thumbnailInner: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    overflow: 'hidden',
  },
  thumbnail: {
    width: 200,
    height: 150,
    borderRadius: 14,
    backgroundColor: '#000',
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
  downloadBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  downloadBytesText: {
    color: '#4FC3F7',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  progressBarTrack: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 4,
    backgroundColor: '#4FC3F7',
    borderRadius: 2,
  },
  stallSubText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    marginTop: 3,
  },
});

export default CachedMedia;
