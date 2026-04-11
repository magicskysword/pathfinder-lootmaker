const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { imageDir } = require('../config');
const { nowIso } = require('../utils/time');

const router = express.Router();
const EQUIP_TYPE = '装备';
const MONEY_TYPE = '金钱';

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, imageDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024
  }
});

function normalizePositiveQuantity(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

function isIntegerQuantity(value) {
  return Math.abs(Number(value) - Math.round(Number(value))) < 1e-9;
}

function clampEquipmentQuantity(rawQuantity, allocationQuantity) {
  const total = Number(allocationQuantity || 0);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const quantity = Number(rawQuantity || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.min(total, quantity);
}

function formatAmount(value) {
  const raw = Number(value || 0);
  const amount = Math.abs(raw) < 1e-9 ? 0 : raw;
  if (!Number.isFinite(amount)) return '0';
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

async function loadCharactersView(db) {
  const [characters, buffs, allocations] = await Promise.all([
    db.all(
      `SELECT id, name, role, color, portrait_path, notes, created_at, updated_at
       FROM characters
       ORDER BY created_at ASC`
    ),
    db.all(
      `SELECT id, character_id, level, name, resource_note, description, created_at, updated_at
       FROM character_buffs
       ORDER BY created_at ASC`
    ),
    db.all(`
      SELECT
        a.id AS allocation_id,
        a.character_id,
        a.item_id,
        a.quantity AS allocation_quantity,
        COALESCE(eq.quantity, 0) AS equipped_quantity,
        i.name,
        i.type,
        i.slot,
        i.unit_price,
        i.weight,
        i.description,
        i.display_description
      FROM item_allocations a
      JOIN items i ON i.id = a.item_id
      LEFT JOIN character_equipment eq ON eq.allocation_id = a.id
      ORDER BY i.created_at ASC, a.created_at ASC
    `)
  ]);

  const buffMap = new Map();
  for (const buff of buffs) {
    const list = buffMap.get(buff.character_id) || [];
    list.push(buff);
    buffMap.set(buff.character_id, list);
  }

  const itemMap = new Map();
  for (const row of allocations) {
    const list = itemMap.get(row.character_id) || [];
    const allocationQuantity = Number(row.allocation_quantity || 0);
    const equippedQuantity = row.type === EQUIP_TYPE
      ? clampEquipmentQuantity(row.equipped_quantity, allocationQuantity)
      : 0;
    list.push({
      allocation_id: row.allocation_id,
      item_id: row.item_id,
      quantity: allocationQuantity,
      equipped_quantity: equippedQuantity,
      backpack_quantity: Math.max(0, allocationQuantity - equippedQuantity),
      equipped: equippedQuantity > 0,
      name: row.name,
      type: row.type,
      slot: row.slot,
      unit_price: Number(row.unit_price || 0),
      weight: Number(row.weight || 0),
      description: row.description,
      display_description: row.display_description
    });
    itemMap.set(row.character_id, list);
  }

  return characters.map((row) => ({
    ...row,
    buffs: buffMap.get(row.id) || [],
    items: itemMap.get(row.id) || []
  }));
}

async function getInventoryAllocation(db, characterId, allocationId) {
  return db.get(`
    SELECT
      a.id AS allocation_id,
      a.character_id,
      a.item_id,
      a.quantity AS allocation_quantity,
      COALESCE(eq.quantity, 0) AS equipped_quantity,
      c.name AS character_name,
      i.name AS item_name,
      i.type AS item_type,
      i.slot AS item_slot,
      i.unit_price,
      i.quantity AS item_quantity
    FROM item_allocations a
    JOIN characters c ON c.id = a.character_id
    JOIN items i ON i.id = a.item_id
    LEFT JOIN character_equipment eq ON eq.allocation_id = a.id
    WHERE a.id = ? AND a.character_id = ?
  `, [allocationId, characterId]);
}

async function getWarehouseItemView(db, itemId) {
  return db.get(`
    SELECT
      i.id,
      i.name,
      i.type,
      i.slot,
      i.quantity,
      i.unit_price,
      COALESCE(SUM(a.quantity), 0) AS allocated_quantity
    FROM items i
    LEFT JOIN item_allocations a ON a.item_id = i.id
    WHERE i.id = ?
    GROUP BY i.id
  `, [itemId]);
}

async function upsertEquipmentQuantity(db, row, quantity) {
  const nextQuantity = clampEquipmentQuantity(quantity, row.allocation_quantity);
  const now = nowIso();
  if (nextQuantity <= 0) {
    await db.run('DELETE FROM character_equipment WHERE allocation_id = ?', [row.allocation_id]);
    return 0;
  }

  const existing = await db.get(
    'SELECT id FROM character_equipment WHERE allocation_id = ?',
    [row.allocation_id]
  );

  if (existing) {
    await db.run(
      `UPDATE character_equipment
       SET quantity = ?, item_id = ?, character_id = ?, updated_at = ?
       WHERE allocation_id = ?`,
      [nextQuantity, row.item_id, row.character_id, now, row.allocation_id]
    );
  } else {
    await db.run(
      `INSERT INTO character_equipment
       (id, allocation_id, item_id, character_id, quantity, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), row.allocation_id, row.item_id, row.character_id, nextQuantity, now, now]
    );
  }

  return nextQuantity;
}

router.get('/', async (req, res, next) => {
  try {
    const db = await getDb();
    const rows = await loadCharactersView(db);
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, role = 'PL', color = '#5B8FF9', notes = '' } = req.body || {};
    if (!name) {
      return res.status(400).json({ message: '角色名不能为空' });
    }

    const db = await getDb();
    const id = uuidv4();
    const now = nowIso();

    await db.run(
      `INSERT INTO characters
      (id, name, role, color, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), role, color, notes, now, now]
    );

    const created = await db.get(
      `SELECT id, name, role, color, portrait_path, notes, created_at, updated_at
       FROM characters WHERE id = ?`,
      [id]
    );

    return res.status(201).json({ ...created, buffs: [], items: [] });
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      return res.status(409).json({ message: '角色名已存在' });
    }
    return next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, role, color, notes } = req.body || {};

    const db = await getDb();
    const exists = await db.get('SELECT * FROM characters WHERE id = ?', [id]);
    if (!exists) {
      return res.status(404).json({ message: '角色不存在' });
    }

    const now = nowIso();
    await db.run(
      `UPDATE characters
       SET name = ?, role = ?, color = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [
        name ?? exists.name,
        role ?? exists.role,
        color ?? exists.color,
        notes ?? exists.notes,
        now,
        id
      ]
    );

    const updated = await db.get(
      `SELECT id, name, role, color, portrait_path, notes, created_at, updated_at
       FROM characters WHERE id = ?`,
      [id]
    );

    return res.json(updated);
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      return res.status(409).json({ message: '角色名已存在' });
    }
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { confirmName } = req.body || {};

    const db = await getDb();
    const target = await db.get('SELECT id, name, portrait_path FROM characters WHERE id = ?', [id]);
    if (!target) {
      return res.status(404).json({ message: '角色不存在' });
    }

    if (!confirmName || confirmName !== target.name) {
      return res.status(400).json({ message: '确认角色名不匹配' });
    }

    await db.run('DELETE FROM characters WHERE id = ?', [id]);

    if (target.portrait_path) {
      const full = path.join(imageDir, path.basename(target.portrait_path));
      if (fs.existsSync(full)) {
        fs.rmSync(full, { force: true });
      }
    }

    return res.json({ message: '角色已删除，并清理分配关系' });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/portrait', upload.single('portrait'), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({ message: '未上传图片文件' });
    }

    const db = await getDb();
    const target = await db.get('SELECT id, portrait_path FROM characters WHERE id = ?', [id]);
    if (!target) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(404).json({ message: '角色不存在' });
    }

    const rel = `/images/${path.basename(req.file.path)}`;
    const now = nowIso();

    await db.run('UPDATE characters SET portrait_path = ?, updated_at = ? WHERE id = ?', [rel, now, id]);

    if (target.portrait_path) {
      const old = path.join(imageDir, path.basename(target.portrait_path));
      if (fs.existsSync(old)) {
        fs.rmSync(old, { force: true });
      }
    }

    return res.json({ portrait_path: rel });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/buffs', async (req, res, next) => {
  try {
    const { id: characterId } = req.params;
    const { level, name, resource_note = '', description = '' } = req.body || {};

    if (!level || !name) {
      return res.status(400).json({ message: 'Buff等级与名称不能为空' });
    }

    const db = await getDb();
    const character = await db.get('SELECT id FROM characters WHERE id = ?', [characterId]);
    if (!character) {
      return res.status(404).json({ message: '角色不存在' });
    }

    const id = uuidv4();
    const now = nowIso();
    await db.run(
      `INSERT INTO character_buffs
      (id, character_id, level, name, resource_note, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, characterId, level, name, resource_note, description, now, now]
    );

    const created = await db.get('SELECT * FROM character_buffs WHERE id = ?', [id]);
    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

router.put('/:characterId/buffs/:buffId', async (req, res, next) => {
  try {
    const { characterId, buffId } = req.params;
    const { level, name, resource_note, description } = req.body || {};

    const db = await getDb();
    const buff = await db.get('SELECT * FROM character_buffs WHERE id = ? AND character_id = ?', [buffId, characterId]);
    if (!buff) {
      return res.status(404).json({ message: 'Buff不存在' });
    }

    await db.run(
      `UPDATE character_buffs
       SET level = ?, name = ?, resource_note = ?, description = ?, updated_at = ?
       WHERE id = ?`,
      [
        level ?? buff.level,
        name ?? buff.name,
        resource_note ?? buff.resource_note,
        description ?? buff.description,
        nowIso(),
        buffId
      ]
    );

    const updated = await db.get('SELECT * FROM character_buffs WHERE id = ?', [buffId]);
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.delete('/:characterId/buffs/:buffId', async (req, res, next) => {
  try {
    const { characterId, buffId } = req.params;
    const db = await getDb();

    const buff = await db.get('SELECT id FROM character_buffs WHERE id = ? AND character_id = ?', [buffId, characterId]);
    if (!buff) {
      return res.status(404).json({ message: 'Buff不存在' });
    }

    await db.run('DELETE FROM character_buffs WHERE id = ?', [buffId]);
    return res.json({ message: 'Buff已删除' });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/inventory/:allocationId/equip', async (req, res, next) => {
  try {
    const { id: characterId, allocationId } = req.params;
    const { quantity } = req.body || {};
    const db = await getDb();
    const row = await getInventoryAllocation(db, characterId, allocationId);
    if (!row) {
      return res.status(404).json({ message: '角色物品不存在' });
    }
    if (row.item_type !== EQUIP_TYPE) {
      return res.status(400).json({ message: '仅装备类型可以执行装备操作' });
    }

    const allocationQuantity = Number(row.allocation_quantity || 0);
    const equippedQuantity = clampEquipmentQuantity(row.equipped_quantity, allocationQuantity);
    const backpackQuantity = Math.max(0, allocationQuantity - equippedQuantity);
    const amount = quantity == null ? backpackQuantity : normalizePositiveQuantity(quantity);
    if (!amount) {
      return res.status(400).json({ message: '装备数量必须大于0' });
    }
    if (!isIntegerQuantity(amount)) {
      return res.status(400).json({ message: '装备数量必须为整数' });
    }
    if (amount > backpackQuantity + 1e-9) {
      return res.status(400).json({ message: `最多只能装备 ${formatAmount(backpackQuantity)}` });
    }

    await upsertEquipmentQuantity(db, row, equippedQuantity + amount);
    return res.json({ message: '物品已装备' });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/inventory/:allocationId/unequip', async (req, res, next) => {
  try {
    const { id: characterId, allocationId } = req.params;
    const { quantity } = req.body || {};
    const db = await getDb();
    const row = await getInventoryAllocation(db, characterId, allocationId);
    if (!row) {
      return res.status(404).json({ message: '角色物品不存在' });
    }

    const allocationQuantity = Number(row.allocation_quantity || 0);
    const equippedQuantity = clampEquipmentQuantity(row.equipped_quantity, allocationQuantity);
    const amount = quantity == null ? equippedQuantity : normalizePositiveQuantity(quantity);
    if (!amount) {
      return res.status(400).json({ message: '卸下数量必须大于0' });
    }
    if (!isIntegerQuantity(amount)) {
      return res.status(400).json({ message: '卸下数量必须为整数' });
    }
    if (amount > equippedQuantity + 1e-9) {
      return res.status(400).json({ message: `最多只能卸下 ${formatAmount(equippedQuantity)}` });
    }

    await upsertEquipmentQuantity(db, row, equippedQuantity - amount);
    return res.json({ message: '物品已放入背包' });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/warehouse/:itemId/withdraw', async (req, res, next) => {
  try {
    const { id: characterId, itemId } = req.params;
    const { quantity } = req.body || {};
    const amount = normalizePositiveQuantity(quantity);
    if (!amount) {
      return res.status(400).json({ message: '取出数量必须大于0' });
    }

    const db = await getDb();
    const [character, item] = await Promise.all([
      db.get('SELECT id FROM characters WHERE id = ?', [characterId]),
      getWarehouseItemView(db, itemId)
    ]);
    if (!character) {
      return res.status(404).json({ message: '角色不存在' });
    }
    if (!item) {
      return res.status(404).json({ message: '仓库物品不存在' });
    }
    if (item.type !== MONEY_TYPE && !isIntegerQuantity(amount)) {
      return res.status(400).json({ message: '非金钱物品取出数量必须为整数' });
    }

    const remainingQuantity = Math.max(0, Number(item.quantity || 0) - Number(item.allocated_quantity || 0));
    if (amount > remainingQuantity + 1e-9) {
      return res.status(400).json({ message: `最多只能取出 ${formatAmount(remainingQuantity)}` });
    }

    const existing = await db.get(
      'SELECT id, quantity FROM item_allocations WHERE item_id = ? AND character_id = ?',
      [itemId, characterId]
    );
    const now = nowIso();
    if (existing) {
      await db.run(
        'UPDATE item_allocations SET quantity = ?, updated_at = ? WHERE id = ?',
        [Number(existing.quantity || 0) + amount, now, existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO item_allocations
         (id, item_id, character_id, quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), itemId, characterId, amount, now, now]
      );
    }

    return res.json({ message: '物品已取出到背包' });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/inventory/:allocationId/store', async (req, res, next) => {
  try {
    const { id: characterId, allocationId } = req.params;
    const { quantity } = req.body || {};
    const amount = normalizePositiveQuantity(quantity);
    if (!amount) {
      return res.status(400).json({ message: '存放数量必须大于0' });
    }

    const db = await getDb();
    const row = await getInventoryAllocation(db, characterId, allocationId);
    if (!row) {
      return res.status(404).json({ message: '角色物品不存在' });
    }
    if (row.item_type !== MONEY_TYPE && !isIntegerQuantity(amount)) {
      return res.status(400).json({ message: '非金钱物品存放数量必须为整数' });
    }

    const allocationQuantity = Number(row.allocation_quantity || 0);
    const equippedQuantity = row.item_type === EQUIP_TYPE
      ? clampEquipmentQuantity(row.equipped_quantity, allocationQuantity)
      : 0;
    const backpackQuantity = Math.max(0, allocationQuantity - equippedQuantity);

    if (amount > backpackQuantity + 1e-9) {
      return res.status(400).json({ message: `最多只能存放 ${formatAmount(backpackQuantity)}` });
    }

    const nextQuantity = allocationQuantity - amount;
    if (nextQuantity <= 1e-9) {
      await db.run('DELETE FROM item_allocations WHERE id = ?', [allocationId]);
    } else {
      await db.run(
        'UPDATE item_allocations SET quantity = ?, updated_at = ? WHERE id = ?',
        [nextQuantity, nowIso(), allocationId]
      );
    }

    return res.json({ message: '物品已放回仓库' });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/inventory/:allocationId/consume', async (req, res, next) => {
  try {
    const { id: characterId, allocationId } = req.params;
    const { quantity, note = '' } = req.body || {};
    const amount = normalizePositiveQuantity(quantity);
    if (!amount) {
      return res.status(400).json({ message: '消耗数量必须大于0' });
    }

    const db = await getDb();
    const row = await getInventoryAllocation(db, characterId, allocationId);
    if (!row) {
      return res.status(404).json({ message: '角色物品不存在' });
    }

    const allocationQuantity = Number(row.allocation_quantity || 0);
    const itemQuantity = Number(row.item_quantity || 0);
    const equippedQuantity = row.item_type === EQUIP_TYPE
      ? clampEquipmentQuantity(row.equipped_quantity, allocationQuantity)
      : 0;
    const backpackQuantity = Math.max(0, allocationQuantity - equippedQuantity);

    if (amount > backpackQuantity + 1e-9) {
      return res.status(400).json({ message: `最多只能消耗 ${formatAmount(backpackQuantity)}` });
    }
    if (amount > itemQuantity + 1e-9) {
      return res.status(400).json({ message: '仓库总量不足，无法消耗' });
    }

    const nextAllocationQuantity = allocationQuantity - amount;
    const nextItemQuantity = itemQuantity - amount;
    const itemValue = Number(row.unit_price || 0) * amount;
    const txId = uuidv4();
    const now = nowIso();

    await db.exec('BEGIN');
    try {
      if (nextAllocationQuantity <= 1e-9) {
        await db.run('DELETE FROM item_allocations WHERE id = ?', [allocationId]);
      } else {
        await db.run(
          'UPDATE item_allocations SET quantity = ?, updated_at = ? WHERE id = ?',
          [nextAllocationQuantity, now, allocationId]
        );
      }

      if (nextItemQuantity <= 1e-9) {
        await db.run('DELETE FROM items WHERE id = ?', [row.item_id]);
      } else {
        await db.run(
          'UPDATE items SET quantity = ?, updated_at = ? WHERE id = ?',
          [nextItemQuantity, now, row.item_id]
        );
      }

      await db.run(
        `INSERT INTO transactions
         (id, type, description, gp_amount, item_value, total_value, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          txId,
          'consume',
          `${row.character_name} 消耗 ${row.item_name} ×${formatAmount(amount)}`,
          0,
          itemValue,
          itemValue,
          note || '',
          now,
          now
        ]
      );

      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }

    const created = await db.get('SELECT * FROM transactions WHERE id = ?', [txId]);
    return res.status(201).json({ message: '物品已消耗', transaction: created });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
