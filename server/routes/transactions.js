const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { nowIso } = require('../utils/time');

const router = express.Router();
const VALID_TRANSACTION_TYPES = ['income', 'expense', 'consume'];

router.get('/', async (req, res, next) => {
  try {
    const db = await getDb();
    const rows = await db.all(`
      SELECT id, type, description, gp_amount, item_value, total_value, note, created_at, updated_at
      FROM transactions
      ORDER BY created_at DESC
    `);
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get('/summary', async (req, res, next) => {
  try {
    const db = await getDb();
    const [income, expense, consume] = await Promise.all([
      db.get("SELECT COALESCE(SUM(total_value), 0) AS total FROM transactions WHERE type = 'income'"),
      db.get("SELECT COALESCE(SUM(total_value), 0) AS total FROM transactions WHERE type = 'expense'"),
      db.get("SELECT COALESCE(SUM(total_value), 0) AS total FROM transactions WHERE type = 'consume'")
    ]);
    return res.json({
      total_income: income.total,
      total_expense: expense.total,
      total_consume: consume.total,
      balance: income.total - expense.total - consume.total
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const {
      type = 'income',
      description = '',
      gp_amount = 0,
      item_value = 0,
      note = ''
    } = req.body || {};

    if (!description) {
      return res.status(400).json({ message: '描述为必填项' });
    }
    if (!VALID_TRANSACTION_TYPES.includes(type)) {
      return res.status(400).json({ message: 'type 必须为 income、expense 或 consume' });
    }

    const total_value = Number(gp_amount || 0) + Number(item_value || 0);
    const db = await getDb();
    const now = nowIso();
    const id = uuidv4();

    await db.run(
      `INSERT INTO transactions (id, type, description, gp_amount, item_value, total_value, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, type, description, Number(gp_amount), Number(item_value), total_value, note, now, now]
    );

    const created = await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = await getDb();

    const target = await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
    if (!target) {
      return res.status(404).json({ message: '记录不存在' });
    }

    const payload = req.body || {};
    const nextType = payload.type ?? target.type;
    if (!VALID_TRANSACTION_TYPES.includes(nextType)) {
      return res.status(400).json({ message: 'type 必须为 income、expense 或 consume' });
    }
    const gp_amount = payload.gp_amount ?? target.gp_amount;
    const item_value = payload.item_value ?? target.item_value;
    const total_value = Number(gp_amount) + Number(item_value);

    await db.run(
      `UPDATE transactions
       SET type = ?, description = ?, gp_amount = ?, item_value = ?, total_value = ?, note = ?, updated_at = ?
       WHERE id = ?`,
      [
        nextType,
        payload.description ?? target.description,
        Number(gp_amount),
        Number(item_value),
        total_value,
        payload.note ?? target.note,
        nowIso(),
        id
      ]
    );

    const updated = await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = await getDb();

    const target = await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
    if (!target) {
      return res.status(404).json({ message: '记录不存在' });
    }

    await db.run('DELETE FROM transactions WHERE id = ?', [id]);
    return res.json({ message: '记录已删除' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
