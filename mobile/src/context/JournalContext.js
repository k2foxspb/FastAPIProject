import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { storage } from '../utils/storage';
import { useNotifications } from './NotificationContext';
import { closeJournalDb, openJournalDb, subscribeJournalChanges } from '../journal/db/database';
import { ensureLocalSettings, getSettings } from '../journal/db/repos/settings';
import { ensureLocalMealTypes } from '../journal/db/repos/diet';
import { startSyncEngine, stopSyncEngine, subscribeSyncState, syncNow } from '../journal/sync/syncEngine';
import { deviceTimeZone, todayKey } from '../journal/utils/dates';
import notifee from '@notifee/react-native';
import { cancelAllJournalTriggers, startReminderScheduler, stopReminderScheduler } from '../journal/notifications/scheduler';
import { applyPendingActions, handleJournalNotificationEvent } from '../journal/notifications/actions';
import { registerJournalBackgroundTask } from '../journal/notifications/backgroundTask';

// Контекст «Журнала жизни»: открывает локальную БД текущего пользователя, запускает
// синхронизацию и сообщает экранам о любых изменениях данных (dataVersion).
const JournalContext = createContext(null);

export const JournalProvider = ({ children }) => {
  const [status, setStatus] = useState('loading'); // loading | ready | auth | error
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [syncState, setSyncState] = useState({ status: 'idle', pending: 0 });
  const userIdRef = useRef(null);
  // currentUserId меняется при входе/выходе; офлайн (профиль не загружен) - берём сохранённый id
  const { currentUserId } = useNotifications();

  const init = useCallback(async () => {
    const id = currentUserId || await storage.getUserId();
    if (!id) {
      if (userIdRef.current) {
        stopSyncEngine();
        stopReminderScheduler();
        // Личные напоминания не должны приходить после выхода из аккаунта
        await cancelAllJournalTriggers();
        await closeJournalDb();
      }
      userIdRef.current = null;
      setUserId(null);
      setStatus('auth');
      return;
    }
    if (id === userIdRef.current) return;
    try {
      setStatus('loading');
      if (userIdRef.current) {
        stopSyncEngine();
        stopReminderScheduler();
        await cancelAllJournalTriggers();
      }
      await openJournalDb(id);
      userIdRef.current = id;
      setUserId(id);
      setSettings(await ensureLocalSettings(id));
      await ensureLocalMealTypes(id);
      setStatus('ready');
      setDataVersion((v) => v + 1);
      startSyncEngine();
      // Действия из уведомлений, которые не удалось записать в фоне
      applyPendingActions(id).catch(() => undefined);
      startReminderScheduler();
      registerJournalBackgroundTask();
    } catch (e) {
      console.log('[Journal] init error', e?.message);
      setError('Не удалось открыть журнал на устройстве');
      setStatus('error');
    }
  }, [currentUserId]);

  useEffect(() => {
    init();
    // Пользователь мог выйти/войти под другим аккаунтом, пока приложение было в фоне
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') init();
    });
    return () => sub.remove();
  }, [init]);

  useEffect(() => () => {
    stopSyncEngine();
    stopReminderScheduler();
  }, []);

  // Нажатия на напоминания и их кнопки, когда приложение открыто (фон - в index.js)
  useEffect(() => {
    let unsubscribe = () => {};
    try {
      unsubscribe = notifee.onForegroundEvent((event) => {
        handleJournalNotificationEvent(event).catch(() => undefined);
      });
    } catch (e) {
      console.log('[Journal] foreground events error', e?.message);
    }
    return () => unsubscribe();
  }, []);

  useEffect(() => subscribeSyncState(setSyncState), []);

  useEffect(() => subscribeJournalChanges((change) => {
    setDataVersion((v) => v + 1);
    if (!change || change.entity === 'settings' || change.remote) {
      getSettings().then((s) => s && setSettings(s)).catch(() => undefined);
    }
  }), []);

  const timezone = settings?.timezone || deviceTimeZone();

  const value = {
    status,
    error,
    userId,
    settings,
    timezone,
    today: todayKey(timezone),
    dataVersion,
    syncState,
    syncNow,
    retry: init,
  };
  return <JournalContext.Provider value={value}>{children}</JournalContext.Provider>;
};

export const useJournal = () => useContext(JournalContext);

// Загрузка данных экрана из SQLite с автоматическим перечитыванием при изменениях.
export const useJournalQuery = (loader, deps = []) => {
  const { status, dataVersion } = useJournal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState(null);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    let cancelled = false;
    loader()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setQueryError(null);
        }
      })
      .catch((e) => {
        console.log('[Journal] query error', e?.message);
        if (!cancelled) setQueryError('Не удалось загрузить данные');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, dataVersion, ...deps]);

  return { data, loading: loading && data === null, error: queryError };
};
