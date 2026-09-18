import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated } from 'react-native';
import { deleteAsync } from 'expo-file-system/legacy';
import { useAudioRecorder, useAudioRecorderState, RecordingPresets, requestRecordingPermissionsAsync } from 'expo-audio';
import { setRecordingAudioMode } from '../../../utils/audioSettings';

// Запись голосовых сообщений через expo-audio
export default function useVoiceRecording({ isMounted }) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedUri, setRecordedUri] = useState(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const isStartingRecording = useRef(false);
  const stopRequested = useRef(false);

  const recordingOptions = useMemo(() => RecordingPresets.HIGH_QUALITY, []);
  const recorder = useAudioRecorder(recordingOptions);
  const recorderStatus = useAudioRecorderState(recorder, 200);
  const recordingDotOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(recordingDotOpacity, {
            toValue: 0.3,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(recordingDotOpacity, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      recordingDotOpacity.setValue(1);
    }
  }, [isRecording]);

  useEffect(() => {
    if (recorderStatus.isRecording) {
      setRecordingDuration(recorderStatus.durationMillis);
    } else if (recorderStatus.durationMillis > 0) {
      // Если запись остановилась, сохраняем финальную длительность
      setRecordingDuration(recorderStatus.durationMillis);
    }
    
    // Добавим лог для отладки в реальном времени
    if (recorderStatus.isRecording && recorderStatus.durationMillis % 1000 < 100) {
      console.log('[ChatScreen] Recorder status:', recorderStatus.isRecording, 'duration:', recorderStatus.durationMillis);
    }
  }, [recorderStatus.durationMillis, recorderStatus.isRecording]);

  const startRecording = async () => {
    if (isStartingRecording.current) return;

    try {
      isStartingRecording.current = true;
      stopRequested.current = false;

      console.log('[ChatScreen] startRecording - permissions...');
      const permission = await requestRecordingPermissionsAsync();
      if (!isMounted.current) return;

      if (permission.status === 'granted') {
        if (stopRequested.current) {
          isStartingRecording.current = false;
          return;
        }

        console.log('[ChatScreen] startRecording - setting audio mode...');
        await setRecordingAudioMode();
        if (!isMounted.current) return;

        if (stopRequested.current) {
          isStartingRecording.current = false;
          return;
        }

        if (recorder) {
          // Prepare recorder explicitly as per expo-audio API
          try {
            await recorder.prepareToRecordAsync(recordingOptions);
          } catch (prepErr) {
            console.error('[ChatScreen] startRecording - prepareToRecordAsync failed:', prepErr);
            throw prepErr;
          }

          // Wait a bit for canRecord to become true after audio mode change
          let canRecordAttempts = 0;
          let canRecord = false;
          while (canRecordAttempts < 10) {
            const s = recorder.getStatus();
            canRecord = !!s?.canRecord;
            if (canRecord) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
            canRecordAttempts++;
          }

          const s0 = recorder.getStatus();
          console.log('[ChatScreen] startRecording - recorder status before record:', {
            isRecording: s0?.isRecording,
            canRecord: s0?.canRecord,
            durationMillis: s0?.durationMillis,
            url: s0?.url,
            uri: recorder.uri,
            canRecordAttempts,
          });

          if (!canRecord) {
            console.warn('[ChatScreen] startRecording - canRecord is still false, attempting record anyway');
          }

          console.log('[ChatScreen] startRecording - calling recorder.record()');

          setRecordedUri(null);
          setRecordingDuration(0);

          try {
            recorder.record();
            console.log('[ChatScreen] startRecording - record() invoked');
          } catch (recordErr) {
            console.error('[ChatScreen] startRecording - record() call failed:', recordErr);
            throw recordErr;
          }

          // Wait for isRecording to flip true
          let attempts = 0;
          let isRec = false;
          while (attempts < 20) {
            const s = recorder.getStatus();
            if (s?.isRecording) {
              isRec = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
            attempts++;
          }

          setIsRecording(isRec);
          console.log('[ChatScreen] startRecording - sync complete. isRecording:', isRec, 'attempts:', attempts);

          if (stopRequested.current) {
            console.log('[ChatScreen] startRecording - stop requested during sync');
            if (isRec) await recorder.stop();
            setIsRecording(false);
          }
        }
      } else {
        Alert.alert('Permission Denied', 'Microphone permission is required');
      }
    } catch (err) {
      console.error('[ChatScreen] startRecording error:', err);
      setIsRecording(false);
    } finally {
      isStartingRecording.current = false;
    }
  };

  const stopRecording = async () => {
    // Mark that stop is requested
    stopRequested.current = true;

    // Immediately update UI to release the button
    const wasRecording = isRecording;
    setIsRecording(false);

    try {
      if (recorder) {
        // Capture status before stopping
        let before = recorder.getStatus();
        const durationAtStop = before?.durationMillis || 0;

        console.log('[ChatScreen] stopRecording - status before stop:', before?.isRecording, 'duration:', durationAtStop, 'wasRecording:', wasRecording);

        // Even if status is false, if it WAS recording visually, give it a moment
        if (!before?.isRecording && wasRecording) {
          console.log('[ChatScreen] stopRecording - waiting for status sync...');
          await new Promise((resolve) => setTimeout(resolve, 200));
          before = recorder.getStatus();
        }

        if (before?.isRecording) {
          await recorder.stop();
        }

        // Wait a bit for Android to finish writing the file
        await new Promise((resolve) => setTimeout(resolve, 400));

        const after = recorder.getStatus();
        const uri = recorder.uri || null;
        const finalDuration = after?.durationMillis || durationAtStop;

        console.log('[ChatScreen] Stop completed. URI:', uri, 'Final Duration:', finalDuration);

        if (uri && finalDuration >= 500) {
          setRecordingDuration(finalDuration);
          setRecordedUri(uri);
        } else if (uri && finalDuration < 500) {
          console.log('[ChatScreen] Recording too short, deleting...');
          setRecordedUri(null);
        } else {
          console.warn('[ChatScreen] Stop finished but URI is missing. Retrying twice...');
          // Attempt 1
          await new Promise((resolve) => setTimeout(resolve, 400));
          let retryUri = recorder.uri || null;
          
          if (!retryUri) {
            // Attempt 2
            console.log('[ChatScreen] Still no URI, final attempt...');
            await new Promise((resolve) => setTimeout(resolve, 600));
            retryUri = recorder.uri || null;
          }

          if (retryUri) {
            console.log('[ChatScreen] URI found on retry:', retryUri);
            setRecordingDuration(finalDuration || 1000);
            setRecordedUri(retryUri);
          } else {
            console.error('[ChatScreen] Failed to get URI after retries');
          }
        }
      }
    } catch (err) {
      console.error('[ChatScreen] stopRecording error:', err);
    }
  };

  const deleteRecording = async () => {
    if (recordedUri) {
      try {
        await deleteAsync(recordedUri, { idempotent: true });
      } catch (e) {
        console.error('Failed to delete recording file', e);
      }
    }
    setRecordedUri(null);
    setRecordingDuration(0);
  };

  // Сброс без удаления файла (после успешной отправки)
  const resetRecording = () => {
    setRecordedUri(null);
    setRecordingDuration(0);
  };

  return {
    isRecording,
    recordedUri,
    recordingDuration,
    recorderStatus,
    recordingDotOpacity,
    startRecording,
    stopRecording,
    deleteRecording,
    resetRecording,
  };
}
