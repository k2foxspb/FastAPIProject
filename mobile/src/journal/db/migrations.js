// Миграции локальной схемы журнала (PRAGMA user_version).
// Таблицы сущностей зеркалят серверные: PK - client_uuid (`uuid`), ссылки - *_uuid.
// Новые фазы добавляют миграции в конец массива, существующие не меняются.

const entityColumns = 'uuid TEXT PRIMARY KEY NOT NULL, created_at TEXT, updated_at TEXT NOT NULL, server_rev INTEGER NOT NULL DEFAULT 0';

export const MIGRATIONS = [
  // 1 - ядро журнала (фаза 1)
  `
  CREATE TABLE IF NOT EXISTS settings (
    ${entityColumns},
    timezone TEXT, week_start INTEGER, kcal_goal INTEGER, protein_g_goal INTEGER, fat_g_goal INTEGER,
    carbs_g_goal INTEGER, water_ml_goal INTEGER, seed_version INTEGER
  );
  CREATE TABLE IF NOT EXISTS trackers (
    ${entityColumns},
    name TEXT NOT NULL, value_type TEXT NOT NULL, unit TEXT, icon TEXT, color TEXT, scale_min REAL, scale_max REAL,
    frequency TEXT, goal_value REAL, goal_direction TEXT, template_key TEXT, sort_order INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS events (
    ${entityColumns},
    kind TEXT NOT NULL, title TEXT NOT NULL, description TEXT, start_date TEXT NOT NULL, start_time TEXT,
    timezone TEXT, duration_min INTEGER, rrule TEXT, until_date TEXT, status TEXT DEFAULT 'planned',
    ref_type TEXT, ref_uuid TEXT, payload TEXT, color TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_events_start ON events(start_date);
  CREATE TABLE IF NOT EXISTS event_occurrences (
    ${entityColumns},
    event_uuid TEXT NOT NULL, occurrence_date TEXT NOT NULL, status TEXT DEFAULT 'planned', moved_date TEXT,
    moved_time TEXT, done_at TEXT, note TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_occ_event ON event_occurrences(event_uuid, occurrence_date);
  CREATE INDEX IF NOT EXISTS ix_occ_moved ON event_occurrences(moved_date);
  CREATE TABLE IF NOT EXISTS reminders (
    ${entityColumns},
    target_type TEXT NOT NULL, target_uuid TEXT NOT NULL, offset_min INTEGER DEFAULT 0, time_of_day TEXT,
    rrule TEXT, enabled INTEGER DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS ix_reminders_target ON reminders(target_uuid);
  CREATE TABLE IF NOT EXISTS diary_entries (
    ${entityColumns},
    entry_date TEXT NOT NULL, entry_time TEXT, title TEXT, body TEXT DEFAULT '', body_format TEXT DEFAULT 'plain',
    mood INTEGER, tags TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_diary_date ON diary_entries(entry_date);
  CREATE TABLE IF NOT EXISTS tracker_values (
    ${entityColumns},
    tracker_uuid TEXT NOT NULL, value_date TEXT NOT NULL, value_time TEXT, num_value REAL, text_value TEXT, note TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_tv_date ON tracker_values(value_date);
  CREATE INDEX IF NOT EXISTS ix_tv_tracker ON tracker_values(tracker_uuid, value_date);
  CREATE TABLE IF NOT EXISTS attachments (
    ${entityColumns},
    owner_type TEXT NOT NULL, owner_uuid TEXT NOT NULL, mime TEXT, size_bytes INTEGER, width INTEGER, height INTEGER,
    local_uri TEXT, upload_state TEXT NOT NULL DEFAULT 'done', upload_attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS ix_att_owner ON attachments(owner_uuid);
  CREATE TABLE IF NOT EXISTS outbox (
    entity TEXT NOT NULL, uuid TEXT NOT NULL, op TEXT NOT NULL, payload TEXT, updated_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
    PRIMARY KEY (entity, uuid)
  );
  CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);
  `,
  // 2 - запланированные локальные уведомления (фаза 1в): текущее окно триггеров Notifee
  `
  CREATE TABLE IF NOT EXISTS scheduled_triggers (
    id TEXT PRIMARY KEY NOT NULL, reminder_uuid TEXT, fire_at INTEGER NOT NULL, title TEXT, body TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_triggers_fire ON scheduled_triggers(fire_at);
  `,
];

export const runMigrations = async (db) => {
  const row = await db.getFirstAsync('PRAGMA user_version');
  let version = row ? row.user_version : 0;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    const next = version + 1;
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
      await db.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
};
