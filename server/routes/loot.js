const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { nowIso } = require('../utils/time');
const { MONEY_TYPE, mergeMoneyItems } = require('../services/itemMerge');

const router = express.Router();

function clampRefundPercent(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 100;
  return Math.min(100, Math.max(0, amount));
}

function roundCurrency(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

async function syncEquipmentForAllocation(db, allocationId) {
  if (!allocationId) return;
  const row = await db.get(`
    SELECT a.id AS allocation_id, a.quantity AS allocation_quantity, i.type
    FROM item_allocations a
    JOIN items i ON i.id = a.item_id
    WHERE a.id = ?
  `, [allocationId]);

  if (!row || row.type !== '装备') {
    await db.run('DELETE FROM character_equipment WHERE allocation_id = ?', [allocationId]);
    return;
  }

  await db.run(
    `UPDATE character_equipment
     SET quantity = MIN(MAX(COALESCE(quantity, 0), 0), ?),
         updated_at = ?
     WHERE allocation_id = ?`,
    [Number(row.allocation_quantity || 0), nowIso(), allocationId]
  );
  await db.run('DELETE FROM character_equipment WHERE allocation_id = ? AND quantity <= 0', [allocationId]);
}

async function creditRefundGpToWarehouse(db, amount, now) {
  const refundAmount = roundCurrency(amount);
  if (refundAmount <= 0) return;

  const existingMoney = await db.get(
    `SELECT id, name, quantity
     FROM items
     WHERE type = ? AND ABS(unit_price - 1) < 1e-9
     ORDER BY created_at ASC
     LIMIT 1`,
    [MONEY_TYPE]
  );

  if (existingMoney) {
    await db.run(
      'UPDATE items SET quantity = ?, updated_at = ? WHERE id = ?',
      [roundCurrency(Number(existingMoney.quantity || 0) + refundAmount), now, existingMoney.id]
    );
    await mergeMoneyItems(db, { names: [existingMoney.name] });
    return;
  }

  await db.run(
    `INSERT INTO items
     (id, name, type, slot, quantity, unit_price, weight, description, display_description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), '金币', MONEY_TYPE, null, refundAmount, 1, 0, '出售返还所得', '', now, now]
  );
  await mergeMoneyItems(db, { names: ['金币'] });
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function distributeQuantities(quantity, characters) {
  const result = [];
  if (!characters.length || quantity <= 0) {
    return result;
  }

  const base = Math.floor(quantity / characters.length);
  let remain = quantity % characters.length;

  for (const character of characters) {
    const amount = base + (remain > 0 ? 1 : 0);
    if (amount > 0) {
      result.push({ characterId: character.id, quantity: amount });
    }
    remain -= 1;
  }

  return result;
}

function weightedDistribute(quantity, characters, getWeight) {
  if (!characters.length || quantity <= 0) {
    return [];
  }

  const weights = characters.map((ch) => Math.max(0.0001, Number(getWeight(ch) || 0)));
  const total = weights.reduce((sum, w) => sum + w, 0);

  const raw = characters.map((ch, idx) => ({
    characterId: ch.id,
    base: (quantity * weights[idx]) / total
  }));

  const floorList = raw.map((x) => ({ ...x, quantity: Math.floor(x.base), frac: x.base - Math.floor(x.base) }));
  let assigned = floorList.reduce((sum, x) => sum + x.quantity, 0);
  let remain = quantity - assigned;

  floorList.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < floorList.length && remain > 0; i += 1) {
    floorList[i].quantity += 1;
    remain -= 1;
  }

  return floorList
    .filter((x) => x.quantity > 0)
    .map((x) => ({ characterId: x.characterId, quantity: x.quantity }));
}

router.get('/', async (req, res, next) => {
  try {
    const db = await getDb();
    const rows = await db.all(`
      SELECT id, item_snapshot, gold_snapshot, distribution_snapshot, note, memo_text, created_at, updated_at
      FROM loot_records
      ORDER BY created_at DESC
    `);

    const result = rows.map((row) => ({
      id: row.id,
      item_snapshot: safeParse(row.item_snapshot, []),
      gold_snapshot: safeParse(row.gold_snapshot, []),
      distribution_snapshot: safeParse(row.distribution_snapshot, {}),
      note: row.note,
      memo_text: row.memo_text,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post('/auto-assign', async (req, res, next) => {
  try {
    const { lootItems = [], rule = 'average', characterWeights = {} } = req.body || {};

    const db = await getDb();
    const characters = await db.all(`
      SELECT id, name
      FROM characters
      WHERE role = 'PL'
      ORDER BY created_at ASC
    `);

    if (!characters.length) {
      return res.status(400).json({ message: '没有可用PL角色用于自动分配' });
    }

    const shuffled = [...characters];
    if (rule === 'random') {
      shuffled.sort(() => Math.random() - 0.5);
    }

    const assignments = [];
    let roundRobinIndex = 0;

    for (const item of lootItems) {
      const quantity = Math.max(0, Math.floor(Number(item.quantity || 0)));
      let alloc = [];

      if (rule === 'round') {
        for (let i = 0; i < quantity; i += 1) {
          const character = characters[(roundRobinIndex + i) % characters.length];
          const found = alloc.find((x) => x.characterId === character.id);
          if (found) {
            found.quantity += 1;
          } else {
            alloc.push({ characterId: character.id, quantity: 1 });
          }
        }
        roundRobinIndex = (roundRobinIndex + quantity) % characters.length;
      } else if (rule === 'value') {
        alloc = weightedDistribute(quantity, characters, () => Math.max(1, Number(item.unit_price || 1)));
      } else if (rule === 'weight') {
        alloc = weightedDistribute(quantity, characters, (ch) => Number(characterWeights[ch.id] || 1));
      } else if (rule === 'random') {
        alloc = distributeQuantities(quantity, shuffled);
      } else {
        alloc = distributeQuantities(quantity, characters);
      }

      assignments.push({
        client_id: item.client_id,
        name: item.name,
        allocations: alloc
      });
    }

    return res.json({ assignments });
  } catch (error) {
    return next(error);
  }
});

router.post('/publish', async (req, res, next) => {
  try {
    const {
      lootItems = [],
      buyItems = [],
      goldItems = [],
      distribution = {},
      note = '',
      memo_text = '',
      mode = 'loot'
    } = req.body || {};

    const sellItems = Array.isArray(lootItems) ? lootItems : [];
    const purchaseItems = Array.isArray(buyItems) ? buyItems : [];
    const isTradeMode = mode === 'expense' || mode === 'trade';

    if (!isTradeMode && sellItems.length === 0) {
      return res.status(400).json({ message: '物品列表不能为空' });
    }
    if (isTradeMode && sellItems.length === 0 && purchaseItems.length === 0) {
      return res.status(400).json({ message: '交易模式至少需要一条卖出项或购入项' });
    }

    const db = await getDb();
    const now = nowIso();

    await db.exec('BEGIN');
    try {
      if (isTradeMode) {
        let soldNonMoneyTotal = 0;
        let spentMoneyTotal = 0;
        let refundGpTotal = 0;

        for (const item of sellItems) {
          const warehouseId = item.warehouse_id;
          const qty = Number(item.quantity || 0);
          if (qty <= 0) continue;
          const type = item.type || '其他';
          const unitPrice = Number(item.unit_price || 0);
          const baseValue = roundCurrency(qty * unitPrice);
          const refundPercent = type === MONEY_TYPE ? 0 : clampRefundPercent(item.refund_percent);

          if (type === MONEY_TYPE) spentMoneyTotal += baseValue;
          else {
            soldNonMoneyTotal += baseValue;
            refundGpTotal += roundCurrency(baseValue * refundPercent / 100);
          }

          if (warehouseId) {
            const existing = await db.get('SELECT id, quantity FROM items WHERE id = ?', [warehouseId]);
            if (existing) {
              const newQty = Number(existing.quantity) - qty;
              if (newQty <= 0) {
                await db.run('DELETE FROM item_allocations WHERE item_id = ?', [warehouseId]);
                await db.run('DELETE FROM items WHERE id = ?', [warehouseId]);
              } else {
                await db.run('UPDATE items SET quantity = ?, updated_at = ? WHERE id = ?', [newQty, now, warehouseId]);
                const allocs = await db.all('SELECT id, quantity FROM item_allocations WHERE item_id = ?', [warehouseId]);
                const totalAlloc = allocs.reduce((s, a) => s + Number(a.quantity), 0);
                if (totalAlloc > newQty) {
                  let remaining = newQty;
                  for (const alloc of allocs) {
                    const newAllocQty = Math.min(Number(alloc.quantity), remaining);
                    if (newAllocQty <= 0) {
                      await db.run('DELETE FROM item_allocations WHERE id = ?', [alloc.id]);
                    } else {
                      await db.run('UPDATE item_allocations SET quantity = ?, updated_at = ? WHERE id = ?', [newAllocQty, now, alloc.id]);
                      await syncEquipmentForAllocation(db, alloc.id);
                    }
                    remaining -= newAllocQty;
                  }
                }
              }
            }
          }
        }

        if (refundGpTotal > 0) {
          await creditRefundGpToWarehouse(db, refundGpTotal, now);
        }

        const purchasedValueTotal = purchaseItems.reduce(
          (sum, item) => sum + roundCurrency(Number(item.quantity || 0) * Number(item.unit_price || 0)),
          0
        );
        const moneyNames = [];
        for (const item of purchaseItems) {
          const quantity = Number(item.quantity || 0);
          if (quantity <= 0) continue;
          const id = uuidv4();

          await db.run(
            `INSERT INTO items
            (id, name, type, slot, quantity, unit_price, weight, description, display_description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              item.name || '未命名物品',
              item.type || '其他',
              item.type === '装备' ? item.slot || null : null,
              quantity,
              Number(item.unit_price || 0),
              Number(item.weight || 0),
              item.description || '',
              item.display_description || '',
              now,
              now
            ]
          );
          if ((item.type || '') === MONEY_TYPE) {
            moneyNames.push(item.name || '');
          }
        }

        if (moneyNames.length) {
          await mergeMoneyItems(db, { names: moneyNames });
        }

        const netTradeValue = roundCurrency(
          soldNonMoneyTotal + spentMoneyTotal - refundGpTotal - purchasedValueTotal
        );
        const txType = netTradeValue > 0 ? 'expense' : 'income';
        const txTotal = roundCurrency(Math.abs(netTradeValue));
        const gpAmount = roundCurrency(
          txType === 'expense'
            ? (spentMoneyTotal - refundGpTotal)
            : (refundGpTotal - spentMoneyTotal)
        );
        const itemValue = roundCurrency(
          txType === 'expense'
            ? (soldNonMoneyTotal - purchasedValueTotal)
            : (purchasedValueTotal - soldNonMoneyTotal)
        );
        const txId = uuidv4();
        const soldNames = sellItems.map((x) => x.name || '未命名').join(', ');
        const boughtNames = purchaseItems.map((x) => x.name || '未命名').join(', ');
        const descriptionParts = [];
        if (soldNames) descriptionParts.push(`卖出/金币支出: ${soldNames}`);
        if (boughtNames) descriptionParts.push(`购入: ${boughtNames}`);
        const summaryNote = [
          note || '',
          `卖出原值 ${roundCurrency(soldNonMoneyTotal)} gp`,
          `金币支出 ${roundCurrency(spentMoneyTotal)} gp`,
          `返还所得 ${roundCurrency(refundGpTotal)} gp`,
          `购入原值 ${roundCurrency(purchasedValueTotal)} gp`
        ].filter(Boolean).join('；');
        await db.run(
          `INSERT INTO transactions (id, type, description, gp_amount, item_value, total_value, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [txId, txType, `交易: ${descriptionParts.join('；') || '未命名交易'}`, gpAmount, itemValue, txTotal, summaryNote, now, now]
        );

        await db.exec('COMMIT');
        return res.status(201).json({ message: '交易已记录，仓库已更新' });
      } else {
        const moneyNames = [];
        for (const item of sellItems) {
          const id = uuidv4();
          const quantity = Number(item.quantity || 0);
          if (quantity <= 0) {
            continue;
          }

          await db.run(
            `INSERT INTO items
            (id, name, type, slot, quantity, unit_price, weight, description, display_description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              item.name || '未命名物品',
              item.type || '其他',
              item.type === '装备' ? item.slot || null : null,
              quantity,
              Number(item.unit_price || 0),
              Number(item.weight || 0),
              item.description || '',
              item.display_description || '',
              now,
              now
            ]
          );
          if ((item.type || '') === MONEY_TYPE) {
            moneyNames.push(item.name || '');
          }

          const allocations = item.allocations || [];
          const sumAllocated = allocations.reduce((sum, x) => sum + Number(x.quantity || 0), 0);
          if (sumAllocated - quantity > 1e-9) {
            throw new Error(`物品 ${item.name || '未命名'} 分配数量超过总数量`);
          }

          for (const alloc of allocations) {
            const allocQty = Number(alloc.quantity || 0);
            if (!alloc.characterId || allocQty <= 0) {
              continue;
            }

            const existsChar = await db.get('SELECT id FROM characters WHERE id = ?', [alloc.characterId]);
            if (!existsChar) {
              continue;
            }

            await db.run(
              `INSERT INTO item_allocations
              (id, item_id, character_id, quantity, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
              [uuidv4(), id, alloc.characterId, allocQty, now, now]
            );
          }
        }

        if (moneyNames.length) {
          await mergeMoneyItems(db, { names: moneyNames });
        }

        // Create loot record
        const recordId = uuidv4();
        await db.run(
          `INSERT INTO loot_records
           (id, item_snapshot, gold_snapshot, distribution_snapshot, note, memo_text, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            recordId,
            JSON.stringify(sellItems),
            JSON.stringify(goldItems),
            JSON.stringify(distribution),
            note,
            memo_text,
            now,
            now
          ]
        );

        const totalItemValue = sellItems.reduce(
          (sum, x) => sum + Number(x.quantity || 0) * Number(x.unit_price || 0), 0
        );
        const totalGpAmount = goldItems.reduce((sum, x) => sum + Number(x.amount || 0), 0);
        const txId = uuidv4();
        const itemNames = sellItems.map(x => x.name || '未命名').join(', ');
        await db.run(
          `INSERT INTO transactions (id, type, description, gp_amount, item_value, total_value, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [txId, 'income', `Loot: ${itemNames}`, totalGpAmount, totalItemValue, totalGpAmount + totalItemValue, note, now, now]
        );

        await db.exec('COMMIT');
        return res.status(201).json({ id: recordId, message: 'Loot已发布并写入仓库、记录与流水' });
      }
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

router.put('/:id/memo', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { memo_text = '' } = req.body || {};

    const db = await getDb();
    const row = await db.get('SELECT id FROM loot_records WHERE id = ?', [id]);
    if (!row) {
      return res.status(404).json({ message: 'Loot记录不存在' });
    }

    await db.run('UPDATE loot_records SET memo_text = ?, updated_at = ? WHERE id = ?', [memo_text, nowIso(), id]);

    return res.json({ message: '备忘录已更新' });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = await getDb();

    const row = await db.get('SELECT id FROM loot_records WHERE id = ?', [id]);
    if (!row) {
      return res.status(404).json({ message: 'Loot记录不存在' });
    }

    await db.run('DELETE FROM loot_records WHERE id = ?', [id]);
    return res.json({ message: 'Loot记录已删除' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
