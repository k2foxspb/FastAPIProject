// Сверка клиентских повторений и перевода времени с общими тест-векторами
// (tests/fixtures/recurrence_vectors.json - их же проверяет pytest на сервере).
// Запуск из каталога mobile: node scripts/check-journal-recurrence.mjs
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const rruleEsm = pathToFileURL(path.join(here, '..', 'node_modules', 'rrule', 'dist', 'esm', 'index.js')).href;

// Исходники приложения импортируют модули без расширения (как принято в Metro) - добавляем '.js';
// rrule берём из ESM-сборки (поле "module", его же использует Metro), а не из UMD.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === 'rrule') return next(${JSON.stringify(rruleEsm)}, context);
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[cm]?js$/.test(specifier)) {
    try {
      return await next(specifier + '.js', context);
    } catch {
      return next(specifier + '/index.js', context);
    }
  }
  return next(specifier, context);
}`));
const utils = path.join(here, '..', 'src', 'journal', 'utils');
const { iterDates } = await import(pathToFileURL(path.join(utils, 'recurrence.js')).href);
const { localToUtc } = await import(pathToFileURL(path.join(utils, 'tz.js')).href);
const { uuidV5, seedUuid, occurrenceUuid } = await import(pathToFileURL(path.join(utils, 'uuid.js')).href);
const { parseMoneyToKop, formatKop } = await import(pathToFileURL(path.join(utils, 'money.js')).href);

const vectors = JSON.parse(readFileSync(path.join(here, '..', '..', 'tests', 'fixtures', 'recurrence_vectors.json'), 'utf8'));

let failed = 0;
for (const v of vectors.expand) {
  const got = iterDates(v.rrule, v.dtstart, v.range[0], v.range[1], v.until || null);
  const ok = JSON.stringify(got) === JSON.stringify(v.expected);
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} expand ${v.name}${ok ? '' : `: ${JSON.stringify(got)} != ${JSON.stringify(v.expected)}`}`);
}
for (const v of vectors.to_utc) {
  const got = localToUtc(v.date, v.time, v.tz).toISOString();
  const expected = new Date(v.expected).toISOString();
  const ok = got === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} to_utc ${v.name}${ok ? '' : `: ${got} != ${expected}`}`);
}
// UUIDv5 - эталоны посчитаны uuid.uuid5(NS_JOURNAL, name) в Python
const checks = [
  ['seed_uuid', seedUuid(42, 'settings'), '2b215d7d-d816-52d2-8474-1d1603646646'],
  ['occurrence_uuid', occurrenceUuid('11111111-2222-4333-8444-555555555555', '2025-03-01'), '3a8abfd2-93e0-5ced-8a21-c6b1aac91fb1'],
  ['uuid5_cyrillic', uuidV5('тест').replace(/-/g, ''), 'fdfed7d77c3450db92a78a5f4bac7f55'],
  ['money_parse_spaces', parseMoneyToKop('1 234,5'), 123450],
  ['money_parse_dot', parseMoneyToKop('0.07'), 7],
  ['money_parse_rub', parseMoneyToKop('15 ₽'), 1500],
  ['money_parse_bad', parseMoneyToKop('1,234,5'), null],
  ['money_parse_3_decimals', parseMoneyToKop('1,999'), null],
  ['money_format', formatKop(123456), '1\u00A0234,56\u00A0₽'],
  ['money_format_negative', formatKop(-5), '−0,05\u00A0₽'],
];
for (const [name, got, expected] of checks) {
  const ok = got === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)} != ${JSON.stringify(expected)}`}`);
}
console.log(failed ? `\n${failed} проверок не прошли` : '\nВсе проверки прошли');
process.exit(failed ? 1 : 0);
