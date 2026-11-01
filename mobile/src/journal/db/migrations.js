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
  // 3 - диета (фаза 2): типы приёмов пищи, продукты и рецепты, записи о еде и воде
  `
  CREATE TABLE IF NOT EXISTS meal_types (
    ${entityColumns},
    name TEXT NOT NULL, default_time TEXT, icon TEXT, sort_order INTEGER DEFAULT 0, reminder_enabled INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS foods (
    ${entityColumns},
    name TEXT NOT NULL, brand TEXT, kcal_100 REAL DEFAULT 0, protein_100 REAL DEFAULT 0, fat_100 REAL DEFAULT 0,
    carbs_100 REAL DEFAULT 0, serving_g REAL, barcode TEXT, source TEXT DEFAULT 'manual', is_recipe INTEGER DEFAULT 0,
    recipe_yield_g REAL, use_count INTEGER DEFAULT 0, last_used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_foods_usage ON foods(use_count DESC, last_used_at DESC);
  CREATE INDEX IF NOT EXISTS ix_foods_barcode ON foods(barcode);
  CREATE TABLE IF NOT EXISTS recipe_items (
    ${entityColumns},
    recipe_uuid TEXT NOT NULL, ingredient_uuid TEXT NOT NULL, grams REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ix_recipe_items_recipe ON recipe_items(recipe_uuid);
  CREATE INDEX IF NOT EXISTS ix_recipe_items_ingredient ON recipe_items(ingredient_uuid);
  CREATE TABLE IF NOT EXISTS food_entries (
    ${entityColumns},
    entry_date TEXT NOT NULL, entry_time TEXT, meal_type_uuid TEXT, food_uuid TEXT, name TEXT NOT NULL,
    grams REAL NOT NULL, kcal REAL DEFAULT 0, protein REAL DEFAULT 0, fat REAL DEFAULT 0, carbs REAL DEFAULT 0, note TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_food_entries_date ON food_entries(entry_date);
  CREATE INDEX IF NOT EXISTS ix_food_entries_meal ON food_entries(meal_type_uuid);
  CREATE INDEX IF NOT EXISTS ix_food_entries_food ON food_entries(food_uuid);
  CREATE TABLE IF NOT EXISTS water_entries (
    ${entityColumns},
    entry_date TEXT NOT NULL, entry_time TEXT NOT NULL, amount_ml INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ix_water_entries_date ON water_entries(entry_date);
  `,
  // 4 - финансы и партии универсального импорта (фаза 3)
  `
  CREATE TABLE IF NOT EXISTS accounts (
    ${entityColumns}, name TEXT NOT NULL, kind TEXT, currency TEXT, opening_balance_kop INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS finance_categories (
    ${entityColumns}, name TEXT NOT NULL, kind TEXT NOT NULL, parent_uuid TEXT, icon TEXT, color TEXT,
    sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS transactions (
    ${entityColumns}, account_uuid TEXT, to_account_uuid TEXT, category_uuid TEXT, import_batch_uuid TEXT,
    transaction_date TEXT NOT NULL, direction TEXT NOT NULL, amount_kop INTEGER NOT NULL, description TEXT DEFAULT '',
    merchant TEXT, note TEXT, external_id TEXT, transfer_pair_uuid TEXT, review_required INTEGER DEFAULT 0, source TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_transactions_date ON transactions(transaction_date);
  CREATE INDEX IF NOT EXISTS ix_transactions_account_date ON transactions(account_uuid, transaction_date);
  CREATE INDEX IF NOT EXISTS ix_transactions_review ON transactions(review_required, transaction_date);
  CREATE TABLE IF NOT EXISTS budgets (
    ${entityColumns}, category_uuid TEXT, period_month TEXT NOT NULL, limit_kop INTEGER NOT NULL, enabled INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS import_rules (
    ${entityColumns}, match_text TEXT NOT NULL, match_field TEXT DEFAULT 'description', category_uuid TEXT,
    priority INTEGER DEFAULT 100, enabled INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS import_profiles (
    ${entityColumns}, name TEXT NOT NULL, file_format TEXT NOT NULL, header_fingerprint TEXT NOT NULL,
    mapping TEXT NOT NULL, date_format TEXT, delimiter TEXT
  );
  CREATE TABLE IF NOT EXISTS import_batches (
    ${entityColumns}, account_uuid TEXT, profile_uuid TEXT, filename TEXT NOT NULL, content_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL, imported_count INTEGER DEFAULT 0, duplicate_count INTEGER DEFAULT 0, reverted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_import_batches_created ON import_batches(created_at DESC);
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
