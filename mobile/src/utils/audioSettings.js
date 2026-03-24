import { setAudioModeAsync } from 'expo-audio';

let currentMode = null;
let modePromise = null;

const setAudioModeSafely = async (mode, settings) => {
  if (currentMode === mode) return;
  
  // Wait for existing promise if any
  if (modePromise) {
    try {
      await modePromise;
    } catch (e) {}
  }
  
  if (currentMode === mode) return;

  modePromise = (async () => {
    console.log(`[AudioSettings] Transitioning to ${mode} mode...`);
    try {
      await setAudioModeAsync(settings);
      currentMode = mode;
      console.log(`[AudioSettings] Successfully set ${mode} mode`);
    } catch (e) {
      console.log(`[AudioSettings] Error setting ${mode} mode:`, e);
      throw e;
    } finally {
      modePromise = null;
    }
  })();

  return modePromise;
};

/**
 * Устанавливает режим аудио для воспроизведения медиа.
 * Включает прерывание звука из других приложений (они встают на паузу).
 */
export const setPlaybackAudioMode = async () => {
  await setAudioModeSafely('playback', {
    allowsRecording: false,
    playsInSilentMode: true,
    interruptionMode: 'doNotMix',
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  });
};

/**
 * Устанавливает режим аудио для записи голосовых сообщений.
 */
export const setRecordingAudioMode = async () => {
  await setAudioModeSafely('recording', {
    allowsRecording: true,
    playsInSilentMode: true,
    interruptionMode: 'doNotMix',
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
    allowsBackgroundRecording: false,
  });
};

/**
 * Устанавливает режим аудио для коротких уведомлений.
 */
export const setNotificationAudioMode = async () => {
  await setAudioModeSafely('notification', {
    allowsRecording: false,
    playsInSilentMode: true,
    interruptionMode: 'mixWithOthers',
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  });
};
