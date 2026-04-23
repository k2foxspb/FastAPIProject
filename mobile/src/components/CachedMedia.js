import React, { useState, useEffect, useRef } from 'react';
import { View, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Text, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { cacheDirectory, getInfoAsync, deleteAsync, createDownloadResumable, writeAsStringAsync } from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  const [cached, setCached] = useState(false);

  const stallTimerRef = useRef(null);
  const lastBytesRef = useRef(0);
  const downloadResumableRef = useRef(null);

  const isVideo = item.message_type === 'video' || item.type === 'video';
  const remoteUri = (item.file_path && (item.file_path.startsWith('http') || item.file_path.startsWith('file://') || item.file_path.startsWith('content://'))) ? item.file_path : (item.file_path ? `${API_BASE_URL}${item.file_path}` : '');
  const fileName = item.file_path ? item.file_path.split('/').pop() : 'unknown';
  const localFileUri = `${cacheDirectory}${fileName}`;
  const doneMarkerUri = `${localFileUri}.done`;

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
      // Pause and save resume state on unmount
      const resumable = downloadResumableRef.current;
      if (resumable) {
        const resumeKey = `dl_resume_${fileName}`;
        resumable.pauseAsync().then(savable => {
          if (savable && typeof savable === 'object' && savable.url &&
              savable.resumeData && typeof savable.resumeData === 'string' && savable.resumeData !== '0' && savable.resumeData.startsWith('{')) {
            AsyncStorage.setItem(resumeKey, JSON.stringify(savable)).catch(() => {});
          }
        }).catch(() => {});
      }
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
        if (isVideo) {
          // For video: check done marker to confirm full download
          const markerInfo = await getInfoAsync(doneMarkerUri);
          if (markerInfo.exists) {
            const fileInfo = await getInfoAsync(localFileUri);
            if (fileInfo.exists && fileInfo.size > 0) {
              setLocalUri(fileInfo.uri);
              setLoading(false);
              setCached(true);
              if (onDownloadProgress) onDownloadProgress(-1, 0, false, true);
              return;
            } else {
              // Marker exists but file missing — clean up
              try { await deleteAsync(doneMarkerUri, { idempotent: true }); } catch (e) {}
              try { await deleteAsync(localFileUri, { idempotent: true }); } catch (e) {}
            }
          } else {
            // No marker — partial or missing, clean up partial file
            try { await deleteAsync(localFileUri, { idempotent: true }); } catch (e) {}
          }
        } else {
          // For images: check file directly (no marker needed)
          const fileInfo = await getInfoAsync(localFileUri);
          if (fileInfo.exists && fileInfo.size > 0) {
            setLocalUri(fileInfo.uri);
            setLoading(false);
            return;
          }
          if (fileInfo.exists && fileInfo.size === 0) {
            try { await deleteAsync(localFileUri, { idempotent: true }); } catch (e) {}
          }
        }

        if (isVideo) {
          // For video: just set remote URI, do NOT auto-download — wait for user tap
          setLocalUri(remoteUri);
          setLoading(false);
          // If this is a fullscreen player (shouldPlay=true, isParentVisible=true, !isStatic),
          // start background download immediately
          if (!isStatic && isParentVisible) {
            downloadFileBackground(remoteUri, localFileUri);
          }
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

  const resumeStorageKey = `dl_resume_${fileName}`;

  const downloadFileBackground = async (remote, local) => {
    setDownloading(true);
    setCached(false);
    setDownloadedBytes(0);
    setTotalBytes(0);
    setIsStalled(false);
    lastBytesRef.current = 0;
    if (onDownloadProgress) onDownloadProgress(0, 0, false);
    const MAX_RETRIES = 3;
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      let resumable = null;
      try {
        // Try to resume from saved state
        let savedResumeData = null;
        try {
          const saved = await AsyncStorage.getItem(resumeStorageKey);
          if (saved) {
            // Validate: must be a JSON string with url field (not "0" or garbage)
            try {
              const parsed = JSON.parse(saved);
              if (parsed && typeof parsed === 'object' && parsed.url &&
                  parsed.resumeData && typeof parsed.resumeData === 'string' && parsed.resumeData !== '0' && parsed.resumeData.startsWith('{')) {
                savedResumeData = saved;
              } else await AsyncStorage.removeItem(resumeStorageKey);
            } catch (_) { await AsyncStorage.removeItem(resumeStorageKey); }
          }
        } catch (_) {}

        const progressCallback = (progress) => {
          const { totalBytesWritten, totalBytesExpectedToWrite } = progress;
          setDownloadedBytes(totalBytesWritten);
          setTotalBytes(totalBytesExpectedToWrite);
          resetStallTimer(totalBytesWritten);
          if (onDownloadProgress) onDownloadProgress(totalBytesWritten, totalBytesExpectedToWrite, isStalled);
        };

        if (savedResumeData) {
          // Resume from where we left off
          resumable = createDownloadResumable(remote, local, {}, progressCallback, savedResumeData);
        } else {
          // Fresh download — delete any partial file
          try { await deleteAsync(local, { idempotent: true }); } catch (_) {}
          try { await deleteAsync(local + '.done', { idempotent: true }); } catch (_) {}
          resumable = createDownloadResumable(remote, local, {}, progressCallback);
        }
        downloadResumableRef.current = resumable;

        const result = savedResumeData
          ? await resumable.resumeAsync()
          : await resumable.downloadAsync();

        // Clear saved resume data on success
        try { await AsyncStorage.removeItem(resumeStorageKey); } catch (_) {}

        if (result && result.uri) {
          // Verify file actually exists on disk before marking as cached
          const verify = await getInfoAsync(result.uri);
          if (verify.exists && verify.size > 0) {
            // Write done marker to confirm full download
            try { await writeAsStringAsync(result.uri + '.done', '1'); } catch (_) {}
            setLocalUri(verify.uri);
            setIsStalled(false);
            if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
            setCached(true);
            if (onDownloadProgress) onDownloadProgress(-1, 0, false, true);
          } else {
            // File missing or empty — delete and don't mark cached
            try { await deleteAsync(result.uri, { idempotent: true }); } catch (_) {}
          }
        }
        // Success — exit loop
        break;
      } catch (e) {
        // Save resume state so next open can continue from here
        if (resumable) {
          try {
            const savable = await resumable.pauseAsync();
            if (savable && typeof savable === 'object' && savable.url &&
                savable.resumeData && typeof savable.resumeData === 'string' && savable.resumeData !== '0' && savable.resumeData.startsWith('{')) {
              await AsyncStorage.setItem(resumeStorageKey, JSON.stringify(savable));
            }
          } catch (_) {}
        }
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
    if (onDownloadProgress) onDownloadProgress(-1, 0, false, true);
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
        <VideoPlayer
          uri={localUri}
          isMuted={true}
          isLooping={false}
          shouldPlay={false}
          style={StyleSheet.absoluteFill}
          useNativeControls={false}
          resizeMode="cover"
        />
        <View style={styles.playOverlay}>
          <View style={styles.playButtonCircle}>
            <MaterialIcons name="play-arrow" size={32} color="#fff" />
          </View>
        </View>
        <View style={styles.statusBadge} pointerEvents="none">
          {cached && !downloading ? (
            <MaterialIcons name="check-circle" size={18} color="#4FC3F7" />
          ) : downloading ? (
            <>
              <ActivityIndicator size={12} color="#4FC3F7" style={{ marginBottom: 2 }} />
              {downloadedBytes > 0 && (
                <Text style={styles.statusBytesText}>
                  {totalBytes > 0
                    ? `${formatBytes(downloadedBytes)}\n/ ${formatBytes(totalBytes)}`
                    : formatBytes(downloadedBytes)}
                </Text>
              )}
              {totalBytes > 0 && downloadedBytes > 0 && (
                <View style={styles.statusProgressTrack}>
                  <View style={[styles.statusProgressFill, { width: `${Math.min(downloadedBytes / totalBytes, 1) * 100}%` }]} />
                </View>
              )}
            </>
          ) : (
            <MaterialIcons name="cloud-download" size={18} color="rgba(255,255,255,0.7)" />
          )}
        </View>
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
  statusBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 5,
    alignItems: 'center',
    minWidth: 28,
  },
  statusBytesText: {
    color: '#4FC3F7',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 2,
  },
  statusProgressTrack: {
    width: 40,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 2,
  },
  statusProgressFill: {
    height: 3,
    backgroundColor: '#4FC3F7',
    borderRadius: 2,
  },
});

export default CachedMedia;
