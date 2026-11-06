// Описание синхронизируемых сущностей журнала на клиенте. Совпадает с реестром
// на сервере (app/services/journal/sync_registry.py): имя сущности, локальная
// таблица SQLite и поля `data` (ссылки - через *_uuid).
// Типы полей: text | int | real | bool | json | time (время хранится как 'HH:MM').

export const ENTITIES = {
  settings: {
    table: 'settings',
    fields: {
      timezone: 'text', week_start: 'int', kcal_goal: 'int', protein_g_goal: 'int', fat_g_goal: 'int',
      carbs_g_goal: 'int', water_ml_goal: 'int', height_cm: 'int', weight_kg: 'real', seed_version: 'int',
    },
  },
  tracker: {
    table: 'trackers',
    fields: {
      name: 'text', value_type: 'text', unit: 'text', icon: 'text', color: 'text', scale_min: 'real',
      scale_max: 'real', frequency: 'text', goal_value: 'real', goal_direction: 'text', template_key: 'text',
      sort_order: 'int', archived: 'bool',
    },
  },
  event: {
    table: 'events',
    fields: {
      kind: 'text', title: 'text', description: 'text', start_date: 'text', start_time: 'time', timezone: 'text',
      duration_min: 'int', rrule: 'text', until_date: 'text', status: 'text', ref_type: 'text', ref_uuid: 'text',
      payload: 'json', color: 'text',
    },
    // Событие трекера удаляется вместе с трекером (как каскад на сервере)
    polyParents: { typeField: 'ref_type', uuidField: 'ref_uuid' },
  },
  event_occurrence: {
    table: 'event_occurrences',
    fields: {
      event_uuid: 'text', occurrence_date: 'text', status: 'text', moved_date: 'text', moved_time: 'time',
      done_at: 'text', note: 'text',
    },
    parents: [{ field: 'event_uuid', entity: 'event' }],
  },
  reminder: {
    table: 'reminders',
    fields: {
      target_type: 'text', target_uuid: 'text', offset_min: 'int', time_of_day: 'time', rrule: 'text', enabled: 'bool',
    },
    polyParents: { typeField: 'target_type', uuidField: 'target_uuid' },
  },
  diary_entry: {
    table: 'diary_entries',
    fields: {
      entry_date: 'text', entry_time: 'time', title: 'text', body: 'text', body_format: 'text', mood: 'int', tags: 'json',
    },
  },
  tracker_value: {
    table: 'tracker_values',
    fields: {
      tracker_uuid: 'text', value_date: 'text', value_time: 'time', num_value: 'real', text_value: 'text', note: 'text',
    },
    parents: [{ field: 'tracker_uuid', entity: 'tracker' }],
  },
  // ---- фаза 2: диета
  meal_type: {
    table: 'meal_types',
    fields: { name: 'text', default_time: 'time', icon: 'text', sort_order: 'int', reminder_enabled: 'bool' },
  },
  food: {
    table: 'foods',
    fields: {
      name: 'text', brand: 'text', kcal_100: 'real', protein_100: 'real', fat_100: 'real', carbs_100: 'real',
      serving_g: 'real', barcode: 'text', source: 'text', is_recipe: 'bool', recipe_yield_g: 'real',
      use_count: 'int', last_used_at: 'text',
    },
  },
  recipe_item: {
    table: 'recipe_items',
    fields: { recipe_uuid: 'text', ingredient_uuid: 'text', grams: 'real' },
    parents: [{ field: 'recipe_uuid', entity: 'food' }, { field: 'ingredient_uuid', entity: 'food' }],
  },
  food_entry: {
    table: 'food_entries',
    fields: {
      entry_date: 'text', entry_time: 'time', meal_type_uuid: 'text', food_uuid: 'text', name: 'text', grams: 'real',
      kcal: 'real', protein: 'real', fat: 'real', carbs: 'real', note: 'text',
    },
    // Удаление продукта или типа приёма пищи не удаляет записи о еде - ссылка обнуляется
    parents: [
      { field: 'meal_type_uuid', entity: 'meal_type', onDelete: 'set_null' },
      { field: 'food_uuid', entity: 'food', onDelete: 'set_null' },
    ],
  },
  water_entry: {
    table: 'water_entries',
    fields: { entry_date: 'text', entry_time: 'time', amount_ml: 'int' },
  },
  // ---- фаза 3: финансы и импорт выписок
  finance_category: {
    table: 'finance_categories',
    fields: { name: 'text', kind: 'text', parent_uuid: 'text', icon: 'text', color: 'text', sort_order: 'int' },
    parents: [{ field: 'parent_uuid', entity: 'finance_category', onDelete: 'set_null' }],
  },
  transaction: {
    table: 'transactions',
    fields: {
      category_uuid: 'text', transaction_date: 'text',
      direction: 'text', amount_kop: 'int', description: 'text', merchant: 'text', note: 'text', external_id: 'text',
      review_required: 'bool', source: 'text',
    },
    parents: [
      { field: 'category_uuid', entity: 'finance_category', onDelete: 'set_null' },
    ],
  },
  import_rule: {
    table: 'import_rules',
    fields: { match_text: 'text', match_field: 'text', category_uuid: 'text', priority: 'int', enabled: 'bool' },
    parents: [{ field: 'category_uuid', entity: 'finance_category', onDelete: 'set_null' }],
  },
  import_profile: {
    table: 'import_profiles',
    fields: { name: 'text', file_format: 'text', header_fingerprint: 'text', mapping: 'json', date_format: 'text', delimiter: 'text' },
  },
  import_batch: {
    table: 'import_batches',
    fields: {
      profile_uuid: 'text', filename: 'text', content_fingerprint: 'text', status: 'text',
      imported_count: 'int', duplicate_count: 'int', reverted_at: 'text',
    },
    parents: [
      { field: 'profile_uuid', entity: 'import_profile', onDelete: 'set_null' },
    ],
    pushUpsert: false,
  },
  // Вложения создаются загрузкой файла (uploader.js), через sync - только удаление.
  attachment: {
    table: 'attachments',
    fields: {
      owner_type: 'text', owner_uuid: 'text', mime: 'text', size_bytes: 'int', width: 'int', height: 'int',
    },
    polyParents: { typeField: 'owner_type', uuidField: 'owner_uuid' },
    pushUpsert: false,
  },
};

export const ENTITY_NAMES = Object.keys(ENTITIES);

const normalizeTimeValue = (value) => {
  if (!value) return null;
  const m = String(value).match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
};

// Значение из JS/сервера -> значение колонки SQLite
export const toDbValue = (type, value) => {
  if (value === undefined || value === null || value === '') return type === 'text' && value === '' ? '' : null;
  switch (type) {
    case 'int': return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : null;
    case 'real': return Number.isFinite(Number(value)) ? Number(value) : null;
    case 'bool': return value ? 1 : 0;
    case 'json': return JSON.stringify(value);
    case 'time': return normalizeTimeValue(value);
    default: return String(value);
  }
};

// Колонка SQLite -> значение JS
export const fromDbValue = (type, value) => {
  if (value === undefined || value === null) return null;
  switch (type) {
    case 'bool': return !!value;
    case 'json':
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    default: return value;
  }
};

export const rowToObject = (entity, row) => {
  if (!row) return null;
  const { fields } = ENTITIES[entity];
  const obj = { ...row };
  Object.entries(fields).forEach(([name, type]) => {
    obj[name] = fromDbValue(type, row[name]);
  });
  return obj;
};

// Данные записи для sync push (только поля сущности)
export const rowToPayload = (entity, row) => {
  const { fields } = ENTITIES[entity];
  const data = {};
  Object.entries(fields).forEach(([name, type]) => {
    data[name] = fromDbValue(type, row[name]);
  });
  return data;
};
