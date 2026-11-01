// Финансовые данные журнала: локальный кэш, CRUD через outbox и суммы в копейках.
import { getJournalDb, notifyJournalChange } from '../database';
import { rowToObject } from '../../sync/entities';
import { deleteEntity, getEntity, saveEntity, saveLocalOnly } from '../repo';
import { getCursor } from '../../sync/outbox';
import { seedUuid } from '../../utils/uuid';
import { getSettings, updateSettings } from './settings';

export const FINANCE_CATEGORY_SEEDS = [
  { key: 'food', name: 'Продукты', kind: 'expense', icon: 'basket-outline' },
  { key: 'transport', name: 'Транспорт', kind: 'expense', icon: 'bus-outline' },
  { key: 'housing', name: 'Дом', kind: 'expense', icon: 'home-outline' },
  { key: 'shopping', name: 'Покупки', kind: 'expense', icon: 'cart-outline' },
  { key: 'health', name: 'Здоровье', kind: 'expense', icon: 'heart-outline' },
  { key: 'entertainment', name: 'Развлечения', kind: 'expense', icon: 'film-outline' },
  { key: 'other_expense', name: 'Прочее', kind: 'expense', icon: 'ellipsis-horizontal-outline' },
  { key: 'salary', name: 'Зарплата', kind: 'income', icon: 'cash-outline' },
  { key: 'other_income', name: 'Прочий доход', kind: 'income', icon: 'trending-up-outline' },
];

export const ensureLocalFinanceSeed = async (userId) => {
  const db = getJournalDb();
  const [account, categories] = await Promise.all([
    db.getFirstAsync('SELECT COUNT(*) AS n FROM accounts'),
    db.getFirstAsync('SELECT COUNT(*) AS n FROM finance_categories'),
  ]);
  if ((await getCursor()) === 0) {
    if (!account?.n) {
      await saveLocalOnly('account', {
        name: 'Наличные', kind: 'cash', currency: 'RUB', opening_balance_kop: 0, archived: false,
      }, seedUuid(userId, 'account:cash'));
    }
    if (!categories?.n) {
      for (const [index, category] of FINANCE_CATEGORY_SEEDS.entries()) {
        await saveLocalOnly('finance_category', {
          name: category.name, kind: category.kind, parent_uuid: null, icon: category.icon,
          color: null, sort_order: (index + 1) * 10,
        }, seedUuid(userId, `finance_category:${category.key}`));
      }
    }
  }
  const settings = await getSettings();
  if (settings && (settings.seed_version || 0) < 3) await updateSettings({ seed_version: 3 });
};

export const listAccounts = async () => {
  const rows = await getJournalDb().getAllAsync('SELECT * FROM accounts WHERE archived = 0 ORDER BY created_at');
  return rows.map((row) => rowToObject('account', row));
};

export const saveAccount = (data, uuid = null) => saveEntity('account', {
  name: String(data.name || '').trim(), kind: data.kind || 'cash', currency: data.currency || 'RUB',
  opening_balance_kop: Math.trunc(Number(data.opening_balance_kop) || 0), archived: !!data.archived,
}, uuid);
export const deleteAccount = (uuid) => deleteEntity('account', uuid);

export const listFinanceCategories = async (kind = null) => {
  const rows = await getJournalDb().getAllAsync(
    `SELECT * FROM finance_categories ${kind ? 'WHERE kind = ?' : ''} ORDER BY sort_order, name`, kind ? [kind] : [],
  );
  return rows.map((row) => rowToObject('finance_category', row));
};
export const saveFinanceCategory = (data, uuid = null) => saveEntity('finance_category', data, uuid);
export const deleteFinanceCategory = (uuid) => deleteEntity('finance_category', uuid);

export const saveTransaction = (data, uuid = null) => saveEntity('transaction', {
  account_uuid: data.account_uuid || null, to_account_uuid: data.to_account_uuid || null,
  category_uuid: data.category_uuid || null, transaction_date: data.transaction_date,
  direction: data.direction || 'expense', amount_kop: Math.abs(Math.trunc(Number(data.amount_kop) || 0)),
  description: String(data.description || '').trim(), merchant: data.merchant || null, note: data.note || null,
  external_id: data.external_id || null, transfer_pair_uuid: data.transfer_pair_uuid || null,
  review_required: !!data.review_required, source: data.source || 'manual',
}, uuid);
export const getTransaction = (uuid) => getEntity('transaction', uuid);
export const deleteTransaction = (uuid) => deleteEntity('transaction', uuid);

export const listTransactions = async ({ from = '1970-01-01', to = '2100-12-31', limit = 500, offset = 0 } = {}) => {
  const rows = await getJournalDb().getAllAsync(
    `SELECT t.*, a.name AS account_name, c.name AS category_name
     FROM transactions t LEFT JOIN accounts a ON a.uuid = t.account_uuid
     LEFT JOIN finance_categories c ON c.uuid = t.category_uuid
     WHERE t.transaction_date BETWEEN ? AND ? ORDER BY t.transaction_date DESC, t.created_at DESC LIMIT ? OFFSET ?`,
    [from, to, limit, offset],
  );
  return rows.map((row) => ({ ...rowToObject('transaction', row), account_name: row.account_name, category_name: row.category_name }));
};

export const accountBalances = async () => {
  const accounts = await listAccounts();
  const rows = await getJournalDb().getAllAsync('SELECT * FROM transactions');
  return accounts.map((account) => {
    let balance = Number(account.opening_balance_kop) || 0;
    rows.forEach((row) => {
      const amount = Number(row.amount_kop) || 0;
      if (row.direction === 'income' && row.account_uuid === account.uuid) balance += amount;
      if (row.direction === 'expense' && row.account_uuid === account.uuid) balance -= amount;
      if (row.direction === 'transfer' && row.account_uuid === account.uuid) balance -= amount;
      if (row.direction === 'transfer' && row.to_account_uuid === account.uuid) balance += amount;
    });
    return { ...account, balance_kop: balance };
  });
};

export const listBudgets = async (month) => {
  const rows = await getJournalDb().getAllAsync(
    `SELECT b.*, c.name AS category_name FROM budgets b LEFT JOIN finance_categories c ON c.uuid = b.category_uuid
     WHERE b.period_month = ? AND b.enabled = 1 ORDER BY c.name`, [month],
  );
  const allTransactions = await getJournalDb().getAllAsync(
    'SELECT category_uuid, SUM(amount_kop) AS amount FROM transactions WHERE direction = ? AND transaction_date LIKE ? GROUP BY category_uuid',
    ['expense', `${month}%`],
  );
  const spent = new Map(allTransactions.map((row) => [row.category_uuid || '', Number(row.amount) || 0]));
  return rows.map((row) => ({
    ...rowToObject('budget', row), category_name: row.category_name || 'Все расходы',
    spent_kop: row.category_uuid ? spent.get(row.category_uuid) || 0 : [...spent.values()].reduce((sum, value) => sum + value, 0),
  }));
};
export const saveBudget = (data, uuid = null) => saveEntity('budget', {
  category_uuid: data.category_uuid || null, period_month: data.period_month,
  limit_kop: Math.abs(Math.trunc(Number(data.limit_kop) || 0)), enabled: data.enabled !== false,
}, uuid);
export const deleteBudget = (uuid) => deleteEntity('budget', uuid);

export const reviewQueue = async () => {
  const rows = await getJournalDb().getAllAsync(
    `SELECT t.*, a.name AS account_name, c.name AS category_name FROM transactions t
     LEFT JOIN accounts a ON a.uuid = t.account_uuid LEFT JOIN finance_categories c ON c.uuid = t.category_uuid
     WHERE t.review_required = 1 ORDER BY t.transaction_date DESC, t.created_at DESC`,
  );
  return rows.map((row) => ({ ...rowToObject('transaction', row), account_name: row.account_name, category_name: row.category_name }));
};
export const resolveReview = async (uuid, categoryUuid) => {
  const transaction = await getTransaction(uuid);
  if (!transaction) return;
  await saveTransaction({ ...transaction, category_uuid: categoryUuid || null, review_required: false }, uuid);
};

export const expenseByDay = async (db, start, end) => {
  const rows = await db.getAllAsync(
    `SELECT transaction_date AS d, SUM(amount_kop) AS amount FROM transactions
     WHERE direction = 'expense' AND transaction_date BETWEEN ? AND ? GROUP BY transaction_date`, [start, end],
  );
  return Object.fromEntries(rows.map(({ d, amount }) => [d, { expense_kop: Math.trunc(Number(amount) || 0) }]));
};

export const listImportRules = async () => {
  const rows = await getJournalDb().getAllAsync('SELECT * FROM import_rules ORDER BY priority, created_at');
  return rows.map((row) => rowToObject('import_rule', row));
};
export const saveImportRule = (data, uuid = null) => saveEntity('import_rule', data, uuid);
export const deleteImportRule = (uuid) => deleteEntity('import_rule', uuid);

export const notifyFinanceChange = () => notifyJournalChange({ entity: 'transaction', local: true });