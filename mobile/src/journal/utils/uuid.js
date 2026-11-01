// Идентификаторы записей журнала.
// - newUuid(): случайный UUIDv4 для новых записей (expo-crypto, с фоллбэком на Math.random);
// - uuidV5(name): детерминированный UUIDv5 в пространстве журнала. Совпадает с
//   uuid.uuid5(NS_JOURNAL, name) на сервере (app/services/journal/seed.py), поэтому
//   стартовые записи и исключения повторений не дублируются между устройствами.

export const NS_JOURNAL = '6f2c1a3e-8d4b-4f7a-9c1e-2b5d7e9f0a13';

let randomUUID = null;
try {
  // В node-скриптах проверки модуля нет - используем фоллбэк
  // eslint-disable-next-line global-require
  randomUUID = require('expo-crypto').randomUUID;
} catch {
  randomUUID = null;
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const formatUuid = (bytes) => {
  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

export const newUuid = () => {
  if (randomUUID) {
    try {
      return randomUUID();
    } catch {
      // падаем в фоллбэк
    }
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
};

const utf8 = (str) => {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const out = [];
  const s = unescape(encodeURIComponent(str));
  for (let i = 0; i < s.length; i += 1) out.push(s.charCodeAt(i));
  return new Uint8Array(out);
};

// Компактная SHA-1 (нужна только для UUIDv5).
const sha1 = (data) => {
  const ml = data.length;
  const withPadding = ((ml + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(withPadding);
  buf.set(data);
  buf[ml] = 0x80;
  const bitLen = ml * 8;
  const view = new DataView(buf.buffer);
  view.setUint32(withPadding - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(withPadding - 4, bitLen >>> 0);

  let h0 = 0x67452301; let h1 = 0xefcdab89; let h2 = 0x98badcfe; let h3 = 0x10325476; let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < withPadding; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i += 1) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0; let b = h1; let c = h2; let d = h3; let e = h4;
    for (let i = 0; i < 80; i += 1) {
      let f; let k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; } else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; } else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; } else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h));
  return out;
};

const uuidToBytes = (uuid) => {
  const h = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

export const uuidV5 = (name, namespace = NS_JOURNAL) => {
  const ns = uuidToBytes(namespace);
  const nameBytes = utf8(name);
  const data = new Uint8Array(ns.length + nameBytes.length);
  data.set(ns);
  data.set(nameBytes, ns.length);
  const hash = sha1(data).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return formatUuid(hash);
};

// UUID стартовых записей пользователя (seed_uuid на сервере).
export const seedUuid = (userId, key) => uuidV5(`${userId}:${key}`);

// UUID исключения/выполнения повторяющегося события на исходную дату: два устройства,
// отметившие одно и то же срабатывание, пишут одну запись.
export const occurrenceUuid = (eventUuid, originalDate) => uuidV5(`occ:${eventUuid}:${originalDate}`);
