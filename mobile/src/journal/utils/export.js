// Экспорт журнала: CSV (с защитой от инъекций формул) и PDF через expo-print + expo-sharing.
import { cacheDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildCsv } from './csv';
import { formatKop } from './money';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const buildExpensesCsv = (transactions) => buildCsv(
  ['Дата', 'Тип', 'Сумма, ₽', 'Категория', 'Описание'],
  transactions.map((t) => [
    t.transaction_date,
    t.direction,
    (Number(t.amount_kop) / 100).toFixed(2).replace('.', ','),
    t.category_name || '',
    t.description || '',
  ]),
);

export const buildNutritionCsv = (days) => buildCsv(
  ['Дата', 'Калории, ккал', 'Белки, г', 'Жиры, г', 'Углеводы, г'],
  days.map((d) => [d.date, d.kcal, d.protein, d.fat, d.carbs]),
);

export const buildWeightCsv = (points) => buildCsv(
  ['Дата', 'Значение'],
  points.map((p) => [p.date, String(p.value).replace('.', ',')]),
);

export const shareCsv = async (fileName, csv) => {
  const uri = `${cacheDirectory}${fileName}`;
  await writeAsStringAsync(uri, csv, { encoding: EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: fileName });
};

export const buildReportHtml = ({ title, period, nutritionAverages, expenseTotalKop, expenseCategories, trackers }) => {
  const rows = (items) => items.map((i) => `<tr><td>${escapeHtml(i.label)}</td><td>${escapeHtml(i.value)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: sans-serif; padding: 24px; color: #222; }
    h1 { font-size: 22px; } h2 { font-size: 16px; margin-top: 20px; }
    table { width: 100%; border-collapse: collapse; } td { padding: 6px; border-bottom: 1px solid #ddd; }
  </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(period)}</p>
    <h2>КБЖУ (среднее в дни с записями)</h2>
    <table>${rows([
      { label: 'Дней с записями', value: nutritionAverages.loggedDays },
      { label: 'Калории, ккал', value: nutritionAverages.kcal },
      { label: 'Белки, г', value: nutritionAverages.protein },
      { label: 'Жиры, г', value: nutritionAverages.fat },
      { label: 'Углеводы, г', value: nutritionAverages.carbs },
    ])}</table>
    <h2>Расходы</h2>
    <table>${rows([{ label: 'Всего', value: formatKop(expenseTotalKop) },
      ...expenseCategories.map((c) => ({ label: c.name, value: formatKop(c.amount_kop) }))])}</table>
    <h2>Трекеры</h2>
    <table>${rows(trackers.map((t) => ({
      label: t.name,
      value: `было ${t.first}, стало ${t.last}, среднее ${t.avg}${t.unit ? ` ${t.unit}` : ''}, записей ${t.count}`,
    })))}</table>
  </body></html>`;
};

export const sharePdf = async (html) => {
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Отчёт' });
};
