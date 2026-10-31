// Роли пользователя - только три: "owner" (Владелец), "admin" (Администратор),
// "user" (Пользователь). В интерфейсе всегда показываем русские подписи,
// независимо от того, что хранится в БД латиницей (см. app/core/roles.py).
export const ROLE_LABELS_RU = {
  owner: 'Владелец',
  admin: 'Администратор',
  user: 'Пользователь',
};

// Имена иконок из набора MaterialCommunityIcons (@expo/vector-icons):
// владелец - корона, администратор - щит охраны.
export const ROLE_ICONS = {
  owner: 'crown',
  admin: 'shield-account',
  user: 'account',
};

export const ROLE_COLORS = {
  owner: '#F5B301',
  admin: '#3B82F6',
  user: '#9E9E9E',
};

export const getRoleLabel = (role) => ROLE_LABELS_RU[role] || 'Пользователь';

export const getRoleIcon = (role) => ROLE_ICONS[role] || 'account';

export const getRoleColor = (role) => ROLE_COLORS[role] || ROLE_COLORS.user;

// Владелец может назначать/снимать роль "admin" у пользователей; роль "owner"
// менять нельзя. Администратор управлять ролями не может (см. app/core/roles.py).
export const canManageRoles = (role) => role === 'owner';

export const isAdminOrOwner = (role) => role === 'owner' || role === 'admin';
