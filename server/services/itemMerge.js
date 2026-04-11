const { v4: uuidv4 } = require('uuid');
const { nowIso } = require('../utils/time');

const MONEY_TYPE = '金钱';

function normalizeMoneyName(name) {
  return String(name || '').trim();
}

function normalizeSlot(slot) {
  const text = String(slot || '').trim();
  if (!text) return null;
  if (text.startsWith('戒指')) return '戒指';
  return text;
}

function buildMergeSignature(item) {
  return JSON.stringify([
    normalizeMoneyName(item.name),
    String(item.type || '').trim(),
    normalizeSlot(item.slot),
    Number(item.unit_price || 0),
    Number(item.weight || 0),
    String(item.description || '').trim(),
    String(item.display_description || '').trim()
  ]);
}

async function loadItemsAndAllocations(db, itemIds) {
  const placeholders = itemIds.map(() => '?').join(', ');
  const items = await db.all(
    `SELECT id, name, type, slot, quantity, unit_price, weight, description, display_description, created_at, updated_at
     FROM items
     WHERE id IN (${placeholders})`,
    itemIds
  );
  const allocations = await db.all(
    `SELECT a.id, a.item_id, a.character_id, a.quantity,
            COALESCE(eq.quantity, 0) AS equipped_quantity
     FROM item_allocations a
     LEFT JOIN character_equipment eq ON eq.allocation_id = a.id
     WHERE a.item_id IN (${placeholders})
     ORDER BY a.created_at ASC`,
    itemIds
  );

  return { items, allocations };
}

async function mergeItemsByIds(db, itemIds, options = {}) {
  const uniqueIds = [...new Set((itemIds || []).filter(Boolean))];
  if (uniqueIds.length < 2) {
    const error = new Error('至少需要两个物品进行合并');
    error.status = 400;
    throw error;
  }

  const {
    templateItemId = null,
    requireTemplateWhenIncompatible = true
  } = options;

  const { items, allocations } = await loadItemsAndAllocations(db, uniqueIds);
  if (items.length !== uniqueIds.length) {
    const error = new Error('存在无效物品ID');
    error.status = 404;
    throw error;
  }

  const signatures = items.map((x) => buildMergeSignature(x));
  const conflict = signatures.some((x) => x !== signatures[0]);
  if (conflict && requireTemplateWhenIncompatible && !templateItemId) {
    const error = new Error('MERGE_TEMPLATE_REQUIRED');
    error.code = 'MERGE_TEMPLATE_REQUIRED';
    error.status = 409;
    error.items = items.map((x) => ({
      id: x.id,
      name: x.name,
      type: x.type,
      slot: x.slot,
      quantity: Number(x.quantity || 0),
      unit_price: Number(x.unit_price || 0),
      weight: Number(x.weight || 0),
      description: x.description || '',
      display_description: x.display_description || ''
    }));
    throw error;
  }

  const sorted = [...items].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const template = templateItemId
    ? items.find((x) => x.id === templateItemId)
    : sorted[0];
  if (!template) {
    const error = new Error('模板物品不存在');
    error.status = 400;
    throw error;
  }

  const totalQuantity = items.reduce((sum, x) => sum + Number(x.quantity || 0), 0);
  const allocByCharacter = new Map();
  for (const row of allocations) {
    const key = row.character_id;
    const current = allocByCharacter.get(key) || { quantity: 0, equippedQuantity: 0 };
    current.quantity += Number(row.quantity || 0);
    current.equippedQuantity += Number(row.equipped_quantity || 0);
    allocByCharacter.set(key, current);
  }

  const now = nowIso();
  await db.run(
    `UPDATE items
     SET name = ?, type = ?, slot = ?, quantity = ?, unit_price = ?, weight = ?, description = ?, display_description = ?, updated_at = ?
     WHERE id = ?`,
    [
      normalizeMoneyName(template.name) || template.name,
      template.type,
      template.type === '装备' ? template.slot || null : null,
      totalQuantity,
      Number(template.unit_price || 0),
      Number(template.weight || 0),
      template.description || '',
      template.display_description || '',
      now,
      template.id
    ]
  );

  await db.run('DELETE FROM item_allocations WHERE item_id = ?', [template.id]);
  for (const [characterId, payload] of allocByCharacter.entries()) {
    const qty = Number(payload?.quantity || 0);
    const equippedQuantity = Math.min(
      qty,
      Math.max(0, Number(payload?.equippedQuantity || 0))
    );
    if (!characterId || qty <= 0) continue;
    const allocationId = uuidv4();
    await db.run(
      `INSERT INTO item_allocations
       (id, item_id, character_id, quantity, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [allocationId, template.id, characterId, qty, now, now]
    );
    if (template.type === '装备' && equippedQuantity > 0) {
      await db.run(
        `INSERT INTO character_equipment
         (id, allocation_id, item_id, character_id, quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), allocationId, template.id, characterId, equippedQuantity, now, now]
      );
    }
  }

  const others = uniqueIds.filter((x) => x !== template.id);
  if (others.length) {
    const placeholders = others.map(() => '?').join(', ');
    await db.run(`DELETE FROM items WHERE id IN (${placeholders})`, others);
  }

  return {
    mergedItemId: template.id,
    mergedItemIds: uniqueIds,
    conflict
  };
}

async function mergeMoneyItems(db, options = {}) {
  const rows = await db.all(
    `SELECT id, name, created_at
     FROM items
     WHERE type = ?
     ORDER BY created_at ASC`,
    [MONEY_TYPE]
  );

  const targetNames = options.names
    ? new Set(options.names.map((x) => normalizeMoneyName(x)).filter(Boolean))
    : null;

  const groups = new Map();
  for (const row of rows) {
    const key = normalizeMoneyName(row.name);
    if (!key) continue;
    if (targetNames && !targetNames.has(key)) continue;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }

  const results = [];
  for (const [nameKey, list] of groups.entries()) {
    if (list.length < 2) {
      results.push({
        name: nameKey,
        merged: false,
        mergedItemId: list[0]?.id || null,
        itemIds: list.map((x) => x.id)
      });
      continue;
    }
    const merged = await mergeItemsByIds(db, list.map((x) => x.id), {
      templateItemId: list[0].id,
      requireTemplateWhenIncompatible: false
    });
    results.push({
      name: nameKey,
      merged: true,
      mergedItemId: merged.mergedItemId,
      itemIds: list.map((x) => x.id)
    });
  }

  return results;
}

module.exports = {
  MONEY_TYPE,
  normalizeMoneyName,
  mergeItemsByIds,
  mergeMoneyItems
};
