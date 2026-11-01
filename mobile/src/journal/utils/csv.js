// CSV с защитой от инъекций формул (CSV/Formula injection): ячейки, которые Excel и
// Google Sheets могут принять за формулу, экранируются апострофом.
const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

export const escapeCsvCell = (value) => {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (DANGEROUS_PREFIX.test(text)) text = `'${text}`;
  if (/[";\n\r,]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

export const buildCsv = (headers, rows) => {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(';'));
  return `\uFEFF${lines.join('\r\n')}`;
};
