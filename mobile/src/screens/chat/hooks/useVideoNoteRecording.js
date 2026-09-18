import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { useCameraPermissions } from 'expo-camera';

// Запись видеосообщений ("кружков") через expo-camera
export default function useVideoNoteRecording() {
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [pendingVideoNoteUri, setPendingVideoNoteUri] = useState(null);
  const [pendingVideoNoteDuration, setPendingVideoNoteDuration] = useState(0);
  const cameraRef = useRef(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [videoRecordingTimer, setVideoRecordingTimer] = useState(0);
  const videoRecordingInterval = useRef(null);

  useEffect(() => {
    let interval;
    if (isVideoRecording) {
      setVideoRecordingTimer(0);
      interval = setInterval(() => {
        setVideoRecordingTimer(prev => prev + 1);
      }, 1000);
      videoRecordingInterval.current = interval;
    } else {
      if (videoRecordingInterval.current) {
        clearInterval(videoRecordingInterval.current);
        videoRecordingInterval.current = null;
      }
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isVideoRecording]);

  const startVideoRecording = async () => {
    try {
      // Использование хука для получения разрешений
      let cameraStatus = cameraPermission?.status;
      if (cameraStatus !== 'granted') {
        const res = await requestCameraPermission();
        cameraStatus = res?.status;
      }
      const { status: audioStatus } = await requestRecordingPermissionsAsync();
      
      if (cameraStatus !== 'granted' || audioStatus !== 'granted') {
        Alert.alert('Доступ запрещен', 'Нам нужны разрешения на камеру и микрофон для записи видеосообщений.');
        return;
      }

      setIsVideoRecording(true);
      const startTime = Date.now();
      
      // Начинаем запись чуть позже, чтобы камера успела инициализироваться
      setTimeout(async () => {
        if (cameraRef.current) {
          try {
            console.log('[ChatScreen] startVideoRecording - starting recordAsync');
            const videoPromise = cameraRef.current.recordAsync({
              maxDuration: 60,
              quality: '720p',
            });
            
            const video = await videoPromise;
            const duration = Date.now() - startTime;
            console.log('[ChatScreen] recordAsync finished. URI:', video?.uri, 'Duration:', duration);
            
            if (video && video.uri) {
              if (duration >= 500) {
                setPendingVideoNoteUri(video.uri);
                setPendingVideoNoteDuration(duration);
              } else {
                console.log('[ChatScreen] Video note too short, discarding...');
              }
            } else {
              console.error('[ChatScreen] recordAsync finished but URI is missing');
            }
          } catch (error) {
            console.error('Video recording error:', error);
          } finally {
            setIsVideoRecording(false);
          }
        }
      }, 500);
      
    } catch (error) {
      console.error('Start video recording error:', error);
      setIsVideoRecording(false);
    }
  };

  const stopVideoRecording = async () => {
    console.log('[ChatScreen] stopVideoRecording called, isVideoRecording:', isVideoRecording);
    if (cameraRef.current && isVideoRecording) {
      try {
        console.log('[ChatScreen] stopVideoRecording - calling stopRecording()');
        cameraRef.current.stopRecording();
      } catch (e) {
        console.error('Error stopping video recording:', e);
      }
      // Не ставим setIsVideoRecording(false) здесь, дождемся завершения recordAsync
    } else if (!isVideoRecording) {
      console.warn('[ChatScreen] stopVideoRecording called but isVideoRecording is false');
    }
  };

  const clearPendingVideoNote = () => {
    setPendingVideoNoteUri(null);
    setPendingVideoNoteDuration(0);
  };

  return {
    cameraRef,
    isVideoRecording,
    videoRecordingTimer,
    pendingVideoNoteUri,
    pendingVideoNoteDuration,
    startVideoRecording,
    stopVideoRecording,
    clearPendingVideoNote,
  };
}
