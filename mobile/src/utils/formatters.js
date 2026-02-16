export const formatName = (user) => {
  if (!user) return '';
  if (user.first_name && user.last_name) {
    return `${user.first_name} ${user.last_name}`;
  }
  return user.first_name || user.last_name || user.email;
};

export const formatStatus = (status, lastSeen) => {
  if (status === 'online') return 'В сети';
  if (!lastSeen) return 'Был(а) недавно';

  try {
    const date = new Date(lastSeen);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return 'Был(а) только что';
    
    if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `Был(а) ${minutes} мин. назад`;
    }

    if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `Был(а) ${hours} ч. назад`;
    }

    if (diffInSeconds < 172800) {
      return 'Был(а) вчера';
    }

    return `Был(а) ${date.toLocaleDateString()}`;
  } catch (e) {
    return 'Был(а) недавно';
  }
};

export const formatFileSize = (bytes) => {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
