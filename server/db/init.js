const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./index');
const { nowIso } = require('../utils/time');

async function initDb() {
  const db = await getDb();
  const equipmentTableExists = await db.get(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'character_equipment'
  `);
  const shouldBackfillLegacyEquipment = !equipmentTableExists;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'PL',
      color TEXT NOT NULL DEFAULT '#5B8FF9',
      portrait_path TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_buffs (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      level TEXT NOT NULL,
      name TEXT NOT NULL,
      resource_note TEXT,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      slot TEXT,
      quantity REAL NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 0,
      description TEXT,
      display_description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS item_allocations (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE,
      UNIQUE(item_id, character_id)
    );

    CREATE TABLE IF NOT EXISTS character_equipment (
      id TEXT PRIMARY KEY,
      allocation_id TEXT NOT NULL UNIQUE,
      item_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(allocation_id) REFERENCES item_allocations(id) ON DELETE CASCADE,
      FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS loot_records (
      id TEXT PRIMARY KEY,
      item_snapshot TEXT NOT NULL,
      gold_snapshot TEXT NOT NULL,
      distribution_snapshot TEXT NOT NULL,
      note TEXT,
      memo_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      provider_type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT,
      model TEXT,
      temperature REAL NOT NULL DEFAULT 1,
      is_multimodal INTEGER NOT NULL DEFAULT 0,
      image_caption_provider_id TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'income',
      description TEXT NOT NULL,
      gp_amount REAL NOT NULL DEFAULT 0,
      item_value REAL NOT NULL DEFAULT 0,
      total_value REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_characters_role ON characters(role);
    CREATE INDEX IF NOT EXISTS idx_allocations_item ON item_allocations(item_id);
    CREATE INDEX IF NOT EXISTS idx_allocations_character ON item_allocations(character_id);
    CREATE INDEX IF NOT EXISTS idx_character_equipment_item ON character_equipment(item_id);
    CREATE INDEX IF NOT EXISTS idx_character_equipment_character ON character_equipment(character_id);
    CREATE INDEX IF NOT EXISTS idx_buffs_character ON character_buffs(character_id);
    CREATE INDEX IF NOT EXISTS idx_loot_created_at ON loot_records(created_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
  `);

  if (shouldBackfillLegacyEquipment) {
    const legacyAllocations = await db.all(`
      SELECT a.id AS allocation_id, a.item_id, a.character_id, a.quantity
      FROM item_allocations a
      JOIN items i ON i.id = a.item_id
      WHERE i.type = '装备' AND a.quantity > 0
    `);
    const now = nowIso();
    for (const row of legacyAllocations) {
      await db.run(
        `INSERT INTO character_equipment
         (id, allocation_id, item_id, character_id, quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          row.allocation_id,
          row.item_id,
          row.character_id,
          Number(row.quantity || 0),
          now,
          now
        ]
      );
    }
  }

  await db.run(`
    DELETE FROM character_equipment
    WHERE allocation_id NOT IN (SELECT id FROM item_allocations)
       OR item_id NOT IN (SELECT id FROM items WHERE type = '装备')
       OR character_id NOT IN (SELECT id FROM characters)
  `);

  await db.run(`
    UPDATE character_equipment
    SET quantity = MIN(
      MAX(COALESCE(quantity, 0), 0),
      COALESCE((SELECT quantity FROM item_allocations WHERE id = allocation_id), 0)
    )
  `);

  await db.run(`
    DELETE FROM character_equipment
    WHERE quantity <= 0
  `);
}

module.exports = {
  initDb
};
