// Фоновый пересчёт окна напоминаний (expo-background-task). ОС запускает задачу
// не чаще раза в ~15 минут и не гарантирует запуск - это дополнение к пересчёту при
// запуске/возврате в приложение, чтобы окно не «заканчивалось», если приложение долго
// не открывали. defineTask должен вызываться на верхнем уровне (импорт из index.js).
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { storage } from '../../utils/storage';
import { getJournalUserId, openJournalDb } from '../db/database';
import { rescheduleAll } from './scheduler';

export const JOURNAL_REMINDERS_TASK = 'journal-reminders-window';

try {
  TaskManager.defineTask(JOURNAL_REMINDERS_TASK, async () => {
    try {
      const userId = await storage.getUserId();
      if (!userId) return BackgroundTask.BackgroundTaskResult.Success;
      const current = getJournalUserId();
      if (current && String(current) !== String(userId)) return BackgroundTask.BackgroundTaskResult.Success;
      if (!current) await openJournalDb(userId);
      await rescheduleAll();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (e) {
      console.log('[JournalReminders] background task error', e?.message);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
} catch (e) {
  console.log('[JournalReminders] defineTask error', e?.message);
}

export const registerJournalBackgroundTask = async () => {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    if (await TaskManager.isTaskRegisteredAsync(JOURNAL_REMINDERS_TASK)) return true;
    await BackgroundTask.registerTaskAsync(JOURNAL_REMINDERS_TASK, { minimumInterval: 6 * 60 });
    return true;
  } catch (e) {
    console.log('[JournalReminders] register task error', e?.message);
    return false;
  }
};

export const unregisterJournalBackgroundTask = async () => {
  try {
    if (await TaskManager.isTaskRegisteredAsync(JOURNAL_REMINDERS_TASK)) {
      await BackgroundTask.unregisterTaskAsync(JOURNAL_REMINDERS_TASK);
    }
  } catch {
    // задача не зарегистрирована
  }
};
