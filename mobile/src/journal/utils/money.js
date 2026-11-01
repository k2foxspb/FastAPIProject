// Деньги в журнале - только целые копейки (никаких float в расчётах и хранении).

const NBSP = '\u00A0';

const groupThousands = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

// 123456 -> '1 234,56 ₽'; withKopecks=false -> '1 235 ₽' (округление до рубля)
export const formatKop = (kop, { withKopecks = true, withSign = false, currency = true } = {}) => {
  const value = Number.isFinite(Number(kop)) ? Math.trunc(Number(kop)) : 0;
  const negative = value < 0;
  const abs = Math.abs(value);
  let text;
  if (withKopecks) {
    const rub = Math.floor(abs / 100);
    const k = abs % 100;
    text = `${groupThousands(String(rub))},${String(k).padStart(2, '0')}`;
  } else {
    text = groupThousands(String(Math.floor((abs + 50) / 100)));
  }
  const sign = negative ? '−' : (withSign && value > 0 ? '+' : '');
  return `${sign}${text}${currency ? `${NBSP}₽` : ''}`;
};

// Компактный вид для ячейки календаря: 950 -> '9,5', 1 250 000 коп -> '12,5к'
export const formatKopCompact = (kop) => {
  const rub = Math.round(Math.abs(Number(kop) || 0) / 100);
  if (rub >= 1000000) return `${(rub / 1000000).toFixed(1).replace('.', ',').replace(',0', '')}м`;
  if (rub >= 10000) return `${Math.round(rub / 1000)}к`;
  if (rub >= 1000) return `${(rub / 1000).toFixed(1).replace('.', ',').replace(',0', '')}к`;
  return String(rub);
};

// Разбор ввода пользователя в копейки без float: '1 234,5' -> 123450.
// Возвращает null, если строка не является суммой.
export const parseMoneyToKop = (input) => {
  if (input === null || input === undefined) return null;
  let s = String(input).replace(/[\s\u00A0\u202F]/g, '').replace(/₽|руб\.?|RUB/gi, '');
  if (!s) return null;
  let negative = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(',', '.');
  const m = s.match(/^(\d{1,13})(?:\.(\d{0,2}))?$/);
  if (!m) return null;
  const kop = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
  return negative ? -kop : kop;
};

// Значение для поля ввода: 123450 -> '1234,50'
export const kopToInput = (kop) => {
  if (kop === null || kop === undefined || kop === '') return '';
  const abs = Math.abs(Math.trunc(Number(kop)));
  const k = abs % 100;
  return `${kop < 0 ? '-' : ''}${Math.floor(abs / 100)}${k ? `,${String(k).padStart(2, '0')}` : ''}`;
};
