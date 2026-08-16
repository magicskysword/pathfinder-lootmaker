const express = require('express');
const { getDb } = require('../db');
const { callProvider } = require('../services/aiService');

const router = express.Router();

const DEFAULT_LOOT_TYPES = ['装备', '药水', '卷轴', '金钱', '其他'];
const DEFAULT_SLOT_OPTIONS = [
  '主手', '副手', '盔甲', '盾牌', '披风', '腰带',
  '头环', '头部', '护符', '戒指', '腕部', '胸部',
  '躯体', '眼睛', '脚部', '手套', '手臂', '奇物'
];

// ===== Data Structure Templates =====

const LOOT_STRUCTURE = '{"loot_items":[{"name":"","type":"","slot":null,"quantity":1,"unit_price":0,"weight":0,"description":""}],"note":""}';
const EXPENSE_STRUCTURE = '{"items":[{"seq":1,"quantity":1,"refund_percent":100}],"buy_items":[{"name":"","type":"其他","slot":null,"quantity":1,"unit_price":0,"weight":0,"description":"","display_description":""}],"note":""}';
const CHARACTER_STRUCTURE = '{"character":{"name":"","role":"PL","color":"#5B8FF9"},"buffs":[{"level":"天级","name":"","resource_note":"","description":""}],"items":[{"name":"","type":"其他","slot":null,"quantity":1,"unit_price":0,"weight":0,"description":""}]}';

// ===== Default Prompts (used when no custom prompt is configured) =====

const DEFAULT_LOOT_PROMPT = [
  '你是TRPG Loot解析助手。',
  '{{game_rules}}',
  '请把输入解析成严格JSON，不要输出任何JSON以外文字。',
  'JSON结构：{{loot_structure}}',
  '当前仓库已有type：{{types}}。',
  'type必须从上述列表中选择；若不确定，使用"其他"。',
  '当前仓库已有装备槽位：{{slots}}。',
  '当type为"装备"时，slot必须从上述槽位中选择；当type不是"装备"时，slot必须为null。',
  '不要创造新的type或slot。',
  '如果缺失字段，使用合理默认值。'
].join('\n');

const DEFAULT_EXPENSE_PROMPT = [
  '你是TRPG 交易解析助手。',
  '{{game_rules}}',
  '用户会提供一份库存列表，格式为：#序号 物品名 ×数量',
  '这里的模式是交易模式。',
  '用户会告诉你哪些库存物品需要卖出/删除，以及可能购入哪些新物品。',
  '返还百分比表示卖出后可获得的 GP 占原价的比例。',
  '请把输入解析成严格JSON，不要输出任何JSON以外文字。',
  'JSON结构：{{expense_structure}}',
  '当前仓库已有type：{{types}}。',
  'buy_items中的type必须从上述列表中选择；若不确定，使用"其他"。',
  '当前仓库已有装备槽位：{{slots}}。',
  'buy_items中当type为"装备"时，slot必须从上述槽位中选择；当type不是"装备"时，slot必须为null。',
  'items表示要从库存删除/出售的物品；seq是库存列表中的序号（正整数），quantity是数量（正整数），refund_percent是出售返还的GP百分比（0到100之间的数字）。',
  'buy_items表示要购入并加入仓库的新物品，结构与Loot物品一致；type必须使用已有类型，装备的slot必须使用已有槽位，非装备slot填null。',
  '如果用户明确提到“按X%出售”“半价出售”“卖出获得X%”，请填写refund_percent。',
  '如果用户没有明确说明返还比例，refund_percent默认填写100。',
  '购入物品会默认自动从仓库金币中付费，不要在items里另外加入金币/金钱支出项。',
  '所有数量必须使用正数。',
  '只输出用户明确提到的卖出项、金币支出项和购入项，不要输出库存列表中未提及的其他物品。'
].join('\n');

const DEFAULT_CHARACTER_PROMPT = [
  '你是TRPG 角色资料解析助手。',
  '{{game_rules}}',
  '请把输入解析成严格JSON，不要输出任何JSON以外文字。',
  'JSON结构：{{character_structure}}',
  'role可选：GM、PL、其他。'
].join('\n');

// Export defaults for settings route
const PROMPT_DEFAULTS = {
  prompt_loot: DEFAULT_LOOT_PROMPT,
  prompt_expense: DEFAULT_EXPENSE_PROMPT,
  prompt_character: DEFAULT_CHARACTER_PROMPT
};

// ===== Template Injection =====

async function loadGameRules(db) {
  const row = await db.get("SELECT value FROM app_settings WHERE key = 'game_rules'");
  return row?.value || '';
}

async function loadCustomPrompt(db, key) {
  const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row?.value || '';
}

function applyTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  // Clean up any remaining empty template vars
  result = result.replace(/\{\{[^}]*\}\}/g, '');
  // Remove blank lines left by empty template vars
  result = result.split('\n').filter(line => line.trim() !== '').join('\n');
  return result;
}

async function loadLootTypeAndSlotContext(db) {
  const typeRows = await db.all(`
    SELECT DISTINCT type
    FROM items
    WHERE type IS NOT NULL AND TRIM(type) <> ''
    ORDER BY type ASC
  `);
  const slotRows = await db.all(`
    SELECT DISTINCT slot
    FROM items
    WHERE slot IS NOT NULL AND TRIM(slot) <> ''
    ORDER BY slot ASC
  `);

  const knownTypes = typeRows
    .map((x) => String(x.type || '').trim())
    .filter(Boolean);
  const knownSlots = slotRows
    .map((x) => {
      const text = String(x.slot || '').trim();
      if (!text) return '';
      if (text.startsWith('戒指')) return '戒指';
      return text;
    })
    .filter(Boolean);

  return {
    types: [...new Set([...DEFAULT_LOOT_TYPES, ...knownTypes])],
    slots: [...new Set([...DEFAULT_SLOT_OPTIONS, ...knownSlots])]
  };
}

async function buildFinalPrompt(db, promptKey, defaultPrompt, extraVars = {}) {
  const customPrompt = await loadCustomPrompt(db, promptKey);
  const template = customPrompt || defaultPrompt;
  const gameRules = await loadGameRules(db);
  return applyTemplate(template, {
    game_rules: gameRules,
    loot_structure: LOOT_STRUCTURE,
    expense_structure: EXPENSE_STRUCTURE,
    character_structure: CHARACTER_STRUCTURE,
    ...extraVars
  });
}


async function getProvider(db, providerId) {
  if (providerId) {
    const row = await db.get('SELECT * FROM ai_providers WHERE id = ?', [providerId]);
    if (row) {
      return row;
    }
  }

  const defaultProvider = await db.get(
    'SELECT * FROM ai_providers WHERE is_default = 1 ORDER BY created_at ASC LIMIT 1'
  );

  if (defaultProvider) {
    return defaultProvider;
  }

  return db.get('SELECT * FROM ai_providers ORDER BY created_at ASC LIMIT 1');
}

async function maybeCaptionImage(db, provider, imageDataUrl) {
  if (!imageDataUrl) {
    return { text: '', imageDataUrl: null };
  }

  if (provider.is_multimodal) {
    return { text: '', imageDataUrl };
  }

  if (!provider.image_caption_provider_id) {
    throw new Error('当前模型非多模态，且未配置图片转述模型');
  }

  const captionProvider = await db.get('SELECT * FROM ai_providers WHERE id = ?', [provider.image_caption_provider_id]);
  if (!captionProvider) {
    throw new Error('图片转述模型配置无效');
  }

  const result = await callProvider(
    captionProvider,
    '你是OCR与信息提取助手，请准确描述图片中的文字、表格和关键数值。输出纯文本。',
    '请描述这张图片中的内容。',
    imageDataUrl
  );

  return {
    text: result.text || '',
    imageDataUrl: null
  };
}

router.get('/providers', async (req, res, next) => {
  try {
    const db = await getDb();
    const rows = await db.all(`
      SELECT id, name, provider_type, model, is_multimodal, is_default
      FROM ai_providers
      ORDER BY is_default DESC, created_at ASC
    `);

    return res.json(
      rows.map((x) => ({
        ...x,
        is_multimodal: Boolean(x.is_multimodal),
        is_default: Boolean(x.is_default)
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.post('/parse-loot', async (req, res, next) => {
  try {
    const { providerId = null, inputText = '', imageDataUrl = '' } = req.body || {};

    if (!inputText && !imageDataUrl) {
      return res.status(400).json({ message: '请输入文本或上传图片' });
    }

    const db = await getDb();
    const provider = await getProvider(db, providerId);
    if (!provider) {
      return res.status(400).json({ message: '请先在设置页配置AI Provider' });
    }
    const lootContext = await loadLootTypeAndSlotContext(db);
    const lootPrompt = await buildFinalPrompt(db, 'prompt_loot', DEFAULT_LOOT_PROMPT, {
      types: JSON.stringify(lootContext.types),
      slots: JSON.stringify(lootContext.slots)
    });

    const caption = await maybeCaptionImage(db, provider, imageDataUrl || null);
    const mergedInput = [inputText, caption.text].filter(Boolean).join('\n\n');

    const result = await callProvider(provider, lootPrompt, mergedInput, caption.imageDataUrl);

    return res.json({
      provider: {
        id: provider.id,
        name: provider.name,
        model: provider.model
      },
      parsed: result.parsed,
      raw_text: result.text
    });
  } catch (error) {
    return res.status(400).json({
      message: 'AI解析失败',
      detail: error.response?.data || error.message
    });
  }
});

router.post('/parse-expense', async (req, res, next) => {
  try {
    const { providerId = null, inputText = '', imageDataUrl = '' } = req.body || {};

    if (!inputText && !imageDataUrl) {
      return res.status(400).json({ message: '请输入文本或上传图片' });
    }

    const db = await getDb();
    const provider = await getProvider(db, providerId);
    if (!provider) {
      return res.status(400).json({ message: '请先在设置页配置AI Provider' });
    }

    const lootContext = await loadLootTypeAndSlotContext(db);
    const expensePrompt = await buildFinalPrompt(db, 'prompt_expense', DEFAULT_EXPENSE_PROMPT, {
      types: JSON.stringify(lootContext.types),
      slots: JSON.stringify(lootContext.slots)
    });
    const caption = await maybeCaptionImage(db, provider, imageDataUrl || null);
    const mergedInput = [inputText, caption.text].filter(Boolean).join('\n\n');

    const result = await callProvider(provider, expensePrompt, mergedInput, caption.imageDataUrl);

    return res.json({
      provider: {
        id: provider.id,
        name: provider.name,
        model: provider.model
      },
      parsed: result.parsed,
      raw_text: result.text
    });
  } catch (error) {
    return res.status(400).json({
      message: 'AI解析失败',
      detail: error.response?.data || error.message
    });
  }
});

router.post('/parse-character', async (req, res, next) => {
  try {
    const { providerId = null, inputText = '', imageDataUrl = '' } = req.body || {};

    if (!inputText && !imageDataUrl) {
      return res.status(400).json({ message: '请输入文本或上传图片' });
    }

    const db = await getDb();
    const provider = await getProvider(db, providerId);
    if (!provider) {
      return res.status(400).json({ message: '请先在设置页配置AI Provider' });
    }

    const characterPrompt = await buildFinalPrompt(db, 'prompt_character', DEFAULT_CHARACTER_PROMPT);
    const caption = await maybeCaptionImage(db, provider, imageDataUrl || null);
    const mergedInput = [inputText, caption.text].filter(Boolean).join('\n\n');

    const result = await callProvider(provider, characterPrompt, mergedInput, caption.imageDataUrl);

    return res.json({
      provider: {
        id: provider.id,
        name: provider.name,
        model: provider.model
      },
      parsed: result.parsed,
      raw_text: result.text
    });
  } catch (error) {
    return res.status(400).json({
      message: 'AI解析失败',
      detail: error.response?.data || error.message
    });
  }
});

module.exports = router;
module.exports.PROMPT_DEFAULTS = PROMPT_DEFAULTS;
