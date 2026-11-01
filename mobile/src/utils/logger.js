// Единый логгер клиента.
// - В production (__DEV__ === false) ничего не выводит.
// - Маскирует чувствительные поля (token, password, authorization, secret, key, email, phone).
// - Никогда не выводит объекты целиком: только безопасный скаляр или маскированный JSON-список полей.

const SENSITIVE_KEY_RE = /(token|password|passwd|authorization|secret|key|otp|code|email|phone|cookie)/i;
const SENSITIVE_VALUE_RE = /(Bearer\s+[A-Za-z0-9._\-]+|eyJ[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{5,})/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

const maskString = (value) =>
  String(value).replace(SENSITIVE_VALUE_RE, '[MASKED]').replace(EMAIL_RE, '[EMAIL]');

const toSafe = (arg) => {
  if (arg === null || arg === undefined) return String(arg);
  if (typeof arg === 'string') return maskString(arg);
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (arg instanceof Error) return maskString(arg.message || arg.name || 'Error');
  // Объекты не логируем целиком: показываем только ключи, значения чувствительных полей скрываем.
  if (typeof arg === 'object') {
    const keys = Object.keys(arg).slice(0, 20);
    const masked = keys.map((k) => (SENSITIVE_KEY_RE.test(k) ? `${k}:[MASKED]` : k));
    return `{${masked.join(', ')}}`;
  }
  return '[unsupported]';
};

const write = (level, tag, args) => {
  if (!__DEV__) return;
  const message = args.map(toSafe).join(' ');
  // eslint-disable-next-line no-console
  const fn = console[level] || console.log;
  fn(`[${tag}] ${message}`);
};

export const logger = {
  debug: (tag, ...args) => write('debug', tag, args),
  info: (tag, ...args) => write('info', tag, args),
  warn: (tag, ...args) => write('warn', tag, args),
  error: (tag, ...args) => write('error', tag, args),
};

export default logger;
