// Иерархия производственных ролей (см. app/core/roles.py на backend).
export const PRODUCTION_ROLES = [
  'owner',
  'shop_chief',
  'section_chief',
  'master',
  'assistant_master',
  'worker',
];

export const ROLE_LABELS_RU = {
  owner: 'Владелец',
  shop_chief: 'Начальник цеха',
  section_chief: 'Начальник участка',
  master: 'Мастер участка',
  assistant_master: 'Помощник мастера участка',
  worker: 'Рабочий',
  // Роли старой e-commerce модели (сосуществуют с производственной иерархией).
  admin: 'Администратор',
  seller: 'Продавец',
  buyer: 'Клиент',
};

// Тематические иконки (Ionicons) для значка должности рядом с аватаркой.
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

export const isProductionRole = (role) => PRODUCTION_ROLES.includes(role);

export const getRoleLabel = (role) => ROLE_LABELS_RU[role] || role;

export const getRoleIcon = (role) => ROLE_ICONS[role] || 'person';

// Рабочий не управляет никем и не видит админ-панель производственной иерархии.
export const canAccessOrgAdmin = (role) => isProductionRole(role) && role !== 'worker';

// Создавать/редактировать/удалять цеха может только владелец; начальник цеха
// лишь видит свой цех и управляет его участками (см. app/core/roles.py).
export const canManageWorkshops = (role) => role === 'owner';

export const canManageSections = (role) => role === 'owner' || role === 'shop_chief';
