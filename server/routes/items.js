const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { nowIso } = require('../utils/time');
const {
  MONEY_TYPE,
  normalizeMoneyName,
  mergeMoneyItems,
  mergeItemsByIds
} = require('../services/itemMerge');

const router = express.Router();

const EQUIP_TYPE = '装备';

async function syncCharacterEquipmentForAllocation(db, allocationId) {
  if (!allocationId) return;

  const allocation = await db.get(`
    SELECT a.id, a.item_id, a.character_id, a.quantity, i.type
    FROM item_allocations a
    JOIN items i ON i.id = a.item_id
    WHERE a.id = ?
  `, [allocationId]);

  if (!allocation || allocation.type !== EQUIP_TYPE) {
    await db.run('DELETE FROM character_equipment WHERE allocation_id = ?', [allocationId]);
    return;
  }

  await db.run(
    `UPDATE character_equipment
     SET quantity = MIN(MAX(COALESCE(quantity, 0), 0), ?),
         item_id = ?,
         character_id = ?,
         updated_at = ?
     WHERE allocation_id = ?`,
    [
      Number(allocation.quantity || 0),
      allocation.item_id,
      allocation.character_id,
      nowIso(),
      allocationId
    ]
  );

  await db.run('DELETE FROM character_equipment WHERE allocation_id = ? AND quantity <= 0', [allocationId]);
}

async function syncCharacterEquipmentForItem(db, itemId) {
  if (!itemId) return;

  const item = await db.get('SELECT id, type FROM items WHERE id = ?', [itemId]);
  if (!item || item.type !== EQUIP_TYPE) {
    await db.run('DELETE FROM character_equipment WHERE item_id = ?', [itemId]);
    return;
  }

  const allocationRows = await db.all(
    'SELECT id FROM item_allocations WHERE item_id = ? ORDER BY created_at ASC',
    [itemId]
  );
  for (const row of allocationRows) {
    await syncCharacterEquipmentForAllocation(db, row.id);
  }
}

async function loadItemsView(db) {
  const items = await db.all(`
    SELECT id, name, type, slot, quantity, unit_price, weight, description, display_description, created_at, updated_at
    FROM items
    ORDER BY created_at DESC
  `);

  const allocations = await db.all(`
    SELECT a.id, a.item_id, a.character_id, a.quantity,
           COALESCE(eq.quantity, 0) AS equipped_quantity,
           c.name AS character_name, c.color AS character_color
    FROM item_allocations a
    JOIN characters c ON c.id = a.character_id
    LEFT JOIN character_equipment eq ON eq.allocation_id = a.id
    ORDER BY a.created_at ASC
  `);

  const allocMap = new Map();
  for (const row of allocations) {
    const list = allocMap.get(row.item_id) || [];
    list.push({
      id: row.id,
      character_id: row.character_id,
      character_name: row.character_name,
      character_color: row.character_color,
      quantity: Number(row.quantity),
      equipped_quantity: Number(row.equipped_quantity || 0)
    });
    allocMap.set(row.item_id, list);
  }

  return items.map((item) => {
    const rows = allocMap.get(item.id) || [];
    const allocated = rows.reduce((sum, x) => sum + Number(x.quantity || 0), 0);
    return {
      ...item,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      weight: Number(item.weight),
      allocations: rows,
      allocated_quantity: allocated,
      remaining_quantity: Number(item.quantity) - allocated
    };
  });
}

router.get('/', async (req, res, next) => {
  try {
    const db = await getDb();
    const result = await loadItemsView(db);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const {
      name,
      type,
      slot = null,
      quantity = 1,
      unit_price = 0,
      weight = 0,
      description = '',
      display_description = ''
    } = req.body || {};

    if (!name || !type) {
      return res.status(400).json({ message: '名称与类型为必填项' });
    }

    const db = await getDb();
    const id = uuidv4();
    const now = nowIso();

    await db.run(
      `INSERT INTO items
      (id, name, type, slot, quantity, unit_price, weight, description, display_description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        type,
        type === EQUIP_TYPE ? slot : null,
        Number(quantity),
        Number(unit_price),
        Number(weight),
        description,
        display_description,
        now,
        now
      ]
    );
    if (type === MONEY_TYPE) {
      await mergeMoneyItems(db, { names: [name] });
    }

    const view = await loadItemsView(db);
    let created = view.find((x) => x.id === id);
    if (type === MONEY_TYPE) {
      const key = normalizeMoneyName(name);
      created = view.find((x) => x.type === MONEY_TYPE && normalizeMoneyName(x.name) === key) || created;
    }

    if (!created) {
      return res.status(500).json({ message: '创建后未找到物品数据' });
    }
    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

router.post('/merge', async (req, res, next) => {
  try {
    const db = await getDb();
    const { itemIds = [], templateItemId = null } = req.body || {};
    const uniqueIds = [...new Set((Array.isArray(itemIds) ? itemIds : []).filter(Boolean))];
    if (uniqueIds.length < 2) {
      return res.status(400).json({ message: '至少需要选择两个物品进行合并' });
    }

    await db.exec('BEGIN');
    try {
      const result = await mergeItemsByIds(db, uniqueIds, {
        templateItemId: templateItemId || null,
        requireTemplateWhenIncompatible: true
      });
      const mergedRow = await db.get('SELECT id, name, type FROM items WHERE id = ?', [result.mergedItemId]);
      if (mergedRow?.type === MONEY_TYPE) {
        await mergeMoneyItems(db, { names: [mergedRow.name] });
      }
      await db.exec('COMMIT');

      const items = await loadItemsView(db);
      const merged = items.find((x) => x.id === result.mergedItemId);
      return res.json({
        item: merged || null,
        merged_ids: result.mergedItemIds,
        conflict: result.conflict
      });
    } catch (error) {
      await db.exec('ROLLBACK');
      if (error.code === 'MERGE_TEMPLATE_REQUIRED') {
        return res.status(409).json({
          message: '选中物品存在差异，请选择一个模板物品后再合并',
          requires_template: true,
          items: error.items || []
        });
      }
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    const target = await db.get('SELECT * FROM items WHERE id = ?', [id]);
    if (!target) {
      return res.status(404).json({ message: '物品不存在' });
    }

    const {
      name,
      type,
      slot,
      quantity,
      unit_price,
      weight,
      description,
      display_description
    } = req.body || {};

    const nextType = type ?? target.type;
    const nextName = name ?? target.name;
    const nextSlot = nextType === EQUIP_TYPE ? slot ?? target.slot : null;

    await db.run(
      `UPDATE items
       SET name = ?, type = ?, slot = ?, quantity = ?, unit_price = ?, weight = ?, description = ?, display_description = ?, updated_at = ?
       WHERE id = ?`,
      [
        name ?? target.name,
        nextType,
        nextSlot,
        quantity == null ? target.quantity : Number(quantity),
        unit_price == null ? target.unit_price : Number(unit_price),
        weight == null ? target.weight : Number(weight),
        description ?? target.description,
        display_description ?? target.display_description,
        nowIso(),
        id
      ]
    );

    if (target.type === MONEY_TYPE || nextType === MONEY_TYPE) {
      await mergeMoneyItems(db, { names: [target.name, nextName] });
    }
    await syncCharacterEquipmentForItem(db, id);

    const view = await loadItemsView(db);
    let updated = view.find((x) => x.id === id);
    if (nextType === MONEY_TYPE) {
      const key = normalizeMoneyName(nextName);
      updated = view.find((x) => x.type === MONEY_TYPE && normalizeMoneyName(x.name) === key) || updated;
    }

    if (!updated) {
      return res.status(404).json({ message: '更新后物品不存在，可能已合并到同名金钱条目' });
    }
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = await getDb();

    const target = await db.get('SELECT id FROM items WHERE id = ?', [id]);
    if (!target) {
      return res.status(404).json({ message: '物品不存在' });
    }

    await db.run('DELETE FROM items WHERE id = ?', [id]);
    return res.json({ message: '物品已删除' });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/split', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body || {};
    const splitQuantity = Number(quantity);
    if (!Number.isFinite(splitQuantity) || splitQuantity <= 0) {
      return res.status(400).json({ message: '拆分数量必须大于0' });
    }

    const db = await getDb();
    const target = await db.get('SELECT * FROM items WHERE id = ?', [id]);
    if (!target) {
      return res.status(404).json({ message: '物品不存在' });
    }
    if (target.type === MONEY_TYPE) {
      return res.status(400).json({ message: '金钱类型会自动合并，不支持拆分' });
    }

    const totalQuantity = Number(target.quantity || 0);
    if (splitQuantity >= totalQuantity) {
      return res.status(400).json({ message: `拆分数量必须小于当前数量 ${totalQuantity}` });
    }

    const allocations = await db.all(
      'SELECT quantity FROM item_allocations WHERE item_id = ?',
      [id]
    );
    const allocated = allocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const remaining = totalQuantity - allocated;
    if (splitQuantity > remaining + 1e-9) {
      return res.status(400).json({ message: `拆分数量超出未分配数量，当前最多可拆 ${remaining}` });
    }

    const now = nowIso();
    const newItemId = uuidv4();
    await db.exec('BEGIN');
    try {
      await db.run(
        'UPDATE items SET quantity = ?, updated_at = ? WHERE id = ?',
        [totalQuantity - splitQuantity, now, id]
      );
      await db.run(
        `INSERT INTO items
        (id, name, type, slot, quantity, unit_price, weight, description, display_description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newItemId,
          target.name,
          target.type,
          target.type === EQUIP_TYPE ? target.slot : null,
          splitQuantity,
          Number(target.unit_price || 0),
          Number(target.weight || 0),
          target.description || '',
          target.display_description || '',
          now,
          now
        ]
      );
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }

    const items = await loadItemsView(db);
    return res.json({
      source_item: items.find((x) => x.id === id) || null,
      created_item: items.find((x) => x.id === newItemId) || null
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/allocations', async (req, res, next) => {
  try {
    const { id: itemId } = req.params;
    const { characterId, quantity = 1, mode = 'merge' } = req.body || {};

    if (!characterId) {
      return res.status(400).json({ message: '缺少角色ID' });
    }

    const db = await getDb();
    const item = await db.get('SELECT * FROM items WHERE id = ?', [itemId]);
    if (!item) {
      return res.status(404).json({ message: '物品不存在' });
    }

    const character = await db.get('SELECT * FROM characters WHERE id = ?', [characterId]);
    if (!character) {
      return res.status(404).json({ message: '角色不存在' });
    }

    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: '分配数量必须大于0' });
    }

    const existingList = await db.all(
      'SELECT * FROM item_allocations WHERE item_id = ? ORDER BY created_at ASC',
      [itemId]
    );

    const same = existingList.find((x) => x.character_id === characterId);
    const totalAssigned = existingList.reduce((sum, x) => sum + Number(x.quantity), 0);
    const assignedToOthers = existingList.filter((x) => x.character_id !== characterId);

    if (Number(item.quantity) <= 1 && assignedToOthers.length > 0 && mode !== 'takeover') {
      return res.status(409).json({
        message: '该物品已分配给其他角色，确认后可抢占分配',
        requires_confirm: true,
        code: 'ITEM_OCCUPIED'
      });
    }

    if (mode === 'takeover') {
      await db.run('DELETE FROM item_allocations WHERE item_id = ? AND character_id <> ?', [itemId, characterId]);
    }

    const currentAmount = same ? Number(same.quantity) : 0;
    const maxAvailable = Number(item.quantity) - (totalAssigned - currentAmount);
    const nextAmount = mode === 'set' || mode === 'takeover' ? amount : currentAmount + amount;

    if (nextAmount > maxAvailable + 1e-9) {
      return res.status(400).json({
        message: `分配数量超出可用数量，当前可用 ${maxAvailable}`
      });
    }

    const now = nowIso();
    let activeAllocationId = same?.id || null;
    if (same) {
      await db.run(
        'UPDATE item_allocations SET quantity = ?, updated_at = ? WHERE id = ?',
        [nextAmount, now, same.id]
      );
      activeAllocationId = same.id;
    } else {
      activeAllocationId = uuidv4();
      await db.run(
        `INSERT INTO item_allocations
         (id, item_id, character_id, quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [activeAllocationId, itemId, characterId, nextAmount, now, now]
      );
    }
    await syncCharacterEquipmentForAllocation(db, activeAllocationId);

    const items = await loadItemsView(db);
    const updated = items.find((x) => x.id === itemId);

    return res.json({ item: updated });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:itemId/allocations/:characterId', async (req, res, next) => {
  try {
    const { itemId, characterId } = req.params;
    const db = await getDb();

    const existing = await db.get(
      'SELECT id FROM item_allocations WHERE item_id = ? AND character_id = ?',
      [itemId, characterId]
    );
    if (!existing) {
      return res.status(404).json({ message: '分配关系不存在' });
    }

    await db.run('DELETE FROM item_allocations WHERE id = ?', [existing.id]);
    const items = await loadItemsView(db);
    const updated = items.find((x) => x.id === itemId);

    return res.json({ item: updated });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
