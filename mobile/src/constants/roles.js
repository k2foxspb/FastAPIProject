// Должности производственной иерархии больше не захардкожены - они хранятся
// в БД (см. app/models/structure.py:Position) и загружаются через
// GET /org/positions. Этот модуль держит локальный кэш, заполняемый вызовом
// loadPositions() при старте приложения (см. App.js), и отдаёт из него
// актуальные данные синхронно, чтобы рендер экранов не ждал сетевой запрос.
import { orgApi } from '../api';

// Запасной вариант на случай, если кэш ещё не загружен (например, самый
// первый рендер после запуска приложения) - совпадает с должностями,
// которые сидируются миграцией на бэкенде.
const FALLBACK_POSITIONS = [
  { code: 'owner', name: 'Владелец', level: 0, scope: 'global' },
  { code: 'shop_chief', name: 'Начальник цеха', level: 1, scope: 'workshop' },
  { code: 'section_chief', name: 'Начальник участка', level: 2, scope: 'section' },
  { code: 'master', name: 'Мастер участка', level: 3, scope: 'section' },
  { code: 'assistant_master', name: 'Помощник мастера участка', level: 4, scope: 'section' },
  { code: 'worker', name: 'Рабочий', level: 5, scope: 'self' },
];

let positionsCache = FALLBACK_POSITIONS;

// Роли старой e-commerce модели (сосуществуют с производственной иерархией,
// должностями не являются и в /org/positions не хранятся).
export const ROLE_LABELS_RU_STATIC = {
  admin: 'Администратор',
  seller: 'Продавец',
  buyer: 'Клиент',
};

export const ROLE_ICONS = {
  owner: 'ribbon',
  shop_chief: 'business',
  section_chief: 'briefcase',
  master: 'construct',
  assistant_master: 'hammer',
  worker: 'hardware-chip',
  admin: 'shield-checkmark',
  seller: 'storefront',
  buyer: 'person',
};

// Загружает актуальный список должностей с сервера и обновляет локальный
// кэш. Безопасно вызывать многократно (например, при каждом открытии
// админ-панели), чтобы сразу видеть изменения, внесённые владельцем.
export const loadPositions = async () => {
  try {
    const res = await orgApi.getPositions();
    if (Array.isArray(res.data) && res.data.length > 0) {
      positionsCache = res.data;
    }
  } catch (err) {
    // Остаёмся на предыдущем кэше/запасном варианте - например, если
    // пользователь ещё не авторизован или сеть недоступна.
  }
  return positionsCache;
};

export const getPositionsCache = () => positionsCache;

export const PRODUCTION_ROLES = () => positionsCache.map(p => p.code);

export const ROLE_LABELS_RU = new Proxy(ROLE_LABELS_RU_STATIC, {
  get(target, prop) {
    const position = positionsCache.find(p => p.code === prop);
    if (position) return position.name;
    return target[prop];
  },
});

export const isProductionRole = (role) => positionsCache.some(p => p.code === role);

export const getRoleLabel = (role) => {
  const position = positionsCache.find(p => p.code === role);
  if (position) return position.name;
  return ROLE_LABELS_RU_STATIC[role] || role;
};

export const getRoleIcon = (role) => ROLE_ICONS[role] || 'person';

export const getRoleScope = (role) => {
  const position = positionsCache.find(p => p.code === role);
  return position ? position.scope : 'self';
};

export const getRoleLevel = (role) => {
  const position = positionsCache.find(p => p.code === role);
  if (position) return position.level;
  const maxLevel = positionsCache.reduce((max, p) => Math.max(max, p.level), 0);
  return maxLevel + 1;
};

// Повторяет на клиенте серверную проверку app/core/roles.py:can_manage_user -
// используется только для локального скрытия/показа элементов интерфейса
// (выбор подчинённого, кнопки редактирования); окончательное решение всегда
// остаётся за сервером.
export const canManageUserClient = (current, target) => {
  if (!current || !target) return false;
  if (current.id === target.id) return false;
  if (current.role === 'owner') return true;
  if (getRoleLevel(target.role) <= getRoleLevel(current.role)) return false;

  const scope = getRoleScope(current.role);
  if (scope === 'global') return true;
  if (scope === 'workshop') return current.workshop_id != null && target.workshop_id === current.workshop_id;
  if (scope === 'section') return current.section_id != null && target.section_id === current.section_id;
  return false;
};

export const canViewUserClient = (current, target) => {
  if (!current || !target) return false;
  if (current.id === target.id) return true;
  if (current.role === 'owner') return true;
  return canManageUserClient(current, target) || getRoleScope(current.role) !== 'self';
};

// Рядовой сотрудник (должность со scope="self") не управляет никем и не
// видит админ-панель производственной иерархии.
export const canAccessOrgAdmin = (role) => isProductionRole(role) && getRoleScope(role) !== 'self';

// Создавать/редактировать/удалять цеха, а также управлять должностями
// может только владелец (см. app/core/roles.py).
export const canManageWorkshops = (role) => role === 'owner';

export const canManageSections = (role) => role === 'owner' || getRoleScope(role) === 'workshop';

export const canManagePositions = (role) => role === 'owner';
