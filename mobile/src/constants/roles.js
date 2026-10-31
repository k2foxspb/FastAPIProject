// Роли пользователя - только три: "owner" (Владелец), "admin" (Администратор),
// "user" (Пользователь). В интерфейсе всегда показываем русские подписи,
// независимо от того, что хранится в БД латиницей (см. app/core/roles.py).
export const ROLE_LABELS_RU = {
  owner: 'Владелец',
  admin: 'Администратор',
  user: 'Пользователь',
};

export const ROLE_ICONS = {
  owner: 'ribbon',
  admin: 'shield-checkmark',
  user: 'person',
};

export const getRoleLabel = (role) => ROLE_LABELS_RU[role] || 'Пользователь';

export const getRoleIcon = (role) => ROLE_ICONS[role] || 'person';

// Владелец может назначать/снимать роль "admin" у пользователей; роль "owner"
// менять нельзя. Администратор управлять ролями не может (см. app/core/roles.py).
export const canManageRoles = (role) => role === 'owner';

export const isAdminOrOwner = (role) => role === 'owner' || role === 'admin';
