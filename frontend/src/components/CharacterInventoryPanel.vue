<template>
  <div class="inventory-shell">
    <div class="inventory-topbar">
      <div class="inventory-summary">
        <span>总价值: <strong>{{ totalValueText }} gp</strong></span>
        <span>已装备: <strong>{{ equippedCount }}</strong></span>
        <span>背包: <strong>{{ backpackCount }}</strong></span>
        <span>仓库可取: <strong>{{ warehouseCount }}</strong></span>
      </div>
      <div class="inventory-filters">
        <n-input
          v-model:value="filter.keyword"
          placeholder="搜索名称 / 槽位..."
          clearable
          size="small"
          style="width: 200px"
        />
        <n-select
          v-model:value="filter.type"
          :options="typeOptions"
          size="small"
          style="width: 120px"
        />
      </div>
    </div>

    <div class="inventory-grid">
      <section class="inventory-panel ornate-frame equipment-panel">
        <div class="inventory-panel-header">
          <div>
            <h4>⚔ 装备栏</h4>
            <p>当前已装备中的物品，可直接脱下回背包。</p>
          </div>
          <span class="panel-count">{{ equippedItems.length }}</span>
        </div>

        <div v-if="!equippedItems.length" class="panel-empty">
          暂无已装备物品
        </div>
        <div v-else class="inventory-list">
          <article
            v-for="item in equippedItems"
            :key="`${item.allocation_id}-equipped`"
            class="inventory-card equipped"
          >
            <div class="inventory-card-main">
              <div class="inventory-card-title-row">
                <span class="type-badge small">{{ item.type }}</span>
                <span v-if="item.slot" class="slot-badge">{{ item.slot }}</span>
                <strong class="inventory-name">{{ item.name }}</strong>
              </div>
              <div class="inventory-meta-row">
                <span>数量 ×{{ formatAmount(item.display_quantity) }}</span>
                <span>{{ item.unit_price }} gp</span>
                <span v-if="item.weight">重量 {{ formatAmount(item.weight) }} lb</span>
              </div>
            </div>
            <div class="inventory-card-actions">
              <n-button size="small" @click="beginUnequipItem(item)">脱下</n-button>
            </div>
          </article>
        </div>
      </section>

      <section class="inventory-panel ornate-frame backpack-panel">
        <div class="inventory-panel-header">
          <div>
            <h4>🎒 背包</h4>
            <p>角色持有但未装备的物品，支持装备、消耗和存放。</p>
          </div>
          <span class="panel-count">{{ backpackItems.length }}</span>
        </div>

        <div v-if="!backpackItems.length" class="panel-empty">
          暂无背包物品
        </div>
        <div v-else class="inventory-list">
          <article
            v-for="item in backpackItems"
            :key="`${item.allocation_id}-backpack`"
            class="inventory-card backpack"
          >
            <div class="inventory-card-main">
              <div class="inventory-card-title-row">
                <span class="type-badge small">{{ item.type }}</span>
                <span v-if="item.slot" class="slot-badge">{{ item.slot }}</span>
                <strong class="inventory-name">{{ item.name }}</strong>
              </div>
              <div class="inventory-meta-row">
                <span>数量 ×{{ formatAmount(item.display_quantity) }}</span>
                <span>{{ item.unit_price }} gp</span>
                <span v-if="item.equipped_quantity > 0" class="muted-inline">
                  另有已装备 ×{{ formatAmount(item.equipped_quantity) }}
                </span>
              </div>
            </div>
            <div class="inventory-card-actions">
              <n-button
                v-if="item.type === '装备'"
                size="small"
                type="primary"
                quaternary
                @click="beginEquipItem(item)"
              >
                装备
              </n-button>
              <n-button size="small" @click="openQuantityModal('store', item, item.display_quantity)">
                存放
              </n-button>
              <button
                class="danger-icon-btn"
                title="消耗"
                @click="openQuantityModal('consume', item, item.display_quantity)"
              >
                🗑
              </button>
            </div>
          </article>
        </div>
      </section>

      <section class="inventory-panel ornate-frame warehouse-panel">
        <div class="inventory-panel-header">
          <div>
            <h4>📦 仓库</h4>
            <p>只显示未分配可取出的数量，不会把已装备部分重复算进来。</p>
          </div>
          <span class="panel-count">{{ warehouseItemsAvailable.length }}</span>
        </div>

        <div v-if="!warehouseItemsAvailable.length" class="panel-empty">
          当前无可取出物品
        </div>
        <div v-else class="inventory-list">
          <article
            v-for="item in warehouseItemsAvailable"
            :key="item.id"
            class="inventory-card warehouse"
          >
            <div class="inventory-card-main">
              <div class="inventory-card-title-row">
                <span class="type-badge small">{{ item.type }}</span>
                <span v-if="item.slot" class="slot-badge">{{ item.slot }}</span>
                <strong class="inventory-name">{{ item.name }}</strong>
              </div>
              <div class="inventory-meta-row">
                <span>可取 ×{{ formatAmount(item.display_quantity) }}</span>
                <span v-if="item.quantity !== item.display_quantity" class="muted-inline">
                  总量 ×{{ formatAmount(item.quantity) }}
                </span>
                <span>{{ item.unit_price }} gp</span>
              </div>
              <div v-if="item.allocations?.length" class="inventory-owners">
                <span
                  v-for="alloc in item.allocations"
                  :key="`${item.id}-${alloc.character_id}`"
                  class="owner-chip"
                  :style="{ borderColor: alloc.character_color, background: `${alloc.character_color}18` }"
                >
                  {{ alloc.character_name }} ×{{ formatAmount(alloc.quantity) }}
                </span>
              </div>
            </div>
            <div class="inventory-card-actions">
              <n-button size="small" type="primary" @click="openQuantityModal('withdraw', item, item.display_quantity)">
                取出
              </n-button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <n-modal
      v-model:show="quantityModal.show"
      preset="card"
      :title="quantityModalTitle"
      style="max-width: 420px"
    >
      <div class="quantity-form">
        <div class="muted">物品：{{ quantityModal.item?.name || '-' }}</div>
        <div class="muted">可操作数量：{{ formatAmount(quantityModal.maxQuantity) }}</div>
        <div class="form-group" style="margin-top: 10px;">
          <label class="form-label">数量</label>
          <n-input-number
            v-model:value="quantityModal.quantity"
            :min="quantityModal.integerOnly ? 1 : 0.01"
            :max="quantityModal.maxQuantity"
            :step="quantityModal.integerOnly ? 1 : 0.01"
            :precision="quantityModal.integerOnly ? 0 : 2"
            style="width: 100%;"
          />
        </div>
        <div v-if="quantityModal.mode === 'consume'" class="form-group" style="margin-top: 10px;">
          <label class="form-label">备注</label>
          <n-input v-model:value="quantityModal.note" placeholder="可选备注，会写入消耗流水" />
        </div>
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="quantityModal.show = false">取消</n-button>
          <n-button type="primary" @click="confirmQuantityAction">确认</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { computed, reactive } from 'vue';
import {
  NButton,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  useMessage
} from 'naive-ui';
import { apiRequest } from '../utils/api';

const props = defineProps({
  character: {
    type: Object,
    default: null
  },
  warehouseItems: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['changed']);
const message = useMessage();

const equipmentSlotOrder = [
  '主手', '副手', '盔甲', '盾牌', '披风', '腰带',
  '头环', '头部', '护符', '戒指', '腕部', '胸部',
  '躯体', '眼睛', '脚部', '手套', '手臂', '奇物'
];
const slotOrderMap = new Map(equipmentSlotOrder.map((slot, idx) => [slot, idx]));

const typeOptions = [
  { label: '全部类型', value: '' },
  { label: '装备', value: '装备' },
  { label: '药水', value: '药水' },
  { label: '卷轴', value: '卷轴' },
  { label: '金钱', value: '金钱' },
  { label: '其他', value: '其他' }
];

const filter = reactive({
  keyword: '',
  type: ''
});

const quantityModal = reactive({
  show: false,
  mode: '',
  item: null,
  maxQuantity: 0,
  quantity: 1,
  integerOnly: false,
  note: ''
});

function formatAmount(value) {
  const raw = Number(value || 0);
  const amount = Math.abs(raw) < 1e-9 ? 0 : raw;
  if (!Number.isFinite(amount)) return '0';
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function normalizeSlot(slot) {
  const text = String(slot || '').trim();
  if (!text) return '';
  if (text.startsWith('戒指')) return '戒指';
  return text;
}

function compareBySlot(a, b) {
  const slotA = normalizeSlot(a.slot);
  const slotB = normalizeSlot(b.slot);
  const orderA = slotOrderMap.has(slotA) ? slotOrderMap.get(slotA) : Number.MAX_SAFE_INTEGER;
  const orderB = slotOrderMap.has(slotB) ? slotOrderMap.get(slotB) : Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function matchFilter(item) {
  const keyword = String(filter.keyword || '').trim().toLowerCase();
  const keywordOk = !keyword || [item.name, item.type, item.slot]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(keyword));
  const typeOk = !filter.type || item.type === filter.type;
  return keywordOk && typeOk;
}

const rawItems = computed(() => props.character?.items || []);

const equippedItems = computed(() => rawItems.value
  .filter((item) => Number(item.equipped_quantity || 0) > 0)
  .map((item) => ({
    ...item,
    display_quantity: Number(item.equipped_quantity || 0)
  }))
  .filter(matchFilter)
  .sort(compareBySlot));

const backpackItems = computed(() => rawItems.value
  .filter((item) => Number(item.backpack_quantity || 0) > 0)
  .map((item) => ({
    ...item,
    display_quantity: Number(item.backpack_quantity || 0)
  }))
  .filter(matchFilter)
  .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))));

const warehouseItemsAvailable = computed(() => props.warehouseItems
  .filter((item) => Number(item.remaining_quantity || 0) > 0)
  .map((item) => ({
    ...item,
    display_quantity: Number(item.remaining_quantity || 0)
  }))
  .filter(matchFilter)
  .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))));

const totalValueText = computed(() => rawItems.value
  .reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0));

const equippedCount = computed(() => equippedItems.value.length);
const backpackCount = computed(() => backpackItems.value.length);
const warehouseCount = computed(() => warehouseItemsAvailable.value.length);

const quantityModalTitle = computed(() => {
  if (quantityModal.mode === 'consume') return '确认消耗数量';
  if (quantityModal.mode === 'store') return '确认存放数量';
  if (quantityModal.mode === 'withdraw') return '确认取出数量';
  if (quantityModal.mode === 'equip') return '确认装备数量';
  if (quantityModal.mode === 'unequip') return '确认卸下数量';
  return '确认数量';
});

function shouldUseIntegerQuantity(mode, item) {
  if (!item) return false;
  if (mode === 'equip' || mode === 'unequip') return true;
  if ((mode === 'withdraw' || mode === 'store') && item.type !== '金钱') return true;
  return false;
}

function getDefaultQuantity(mode, item, maxQuantity) {
  const max = Number(maxQuantity || 0);
  const integerOnly = shouldUseIntegerQuantity(mode, item);
  if (integerOnly) {
    return max >= 1 ? 1 : 0;
  }
  if (max <= 0) return 0.01;
  return Math.min(max, 1);
}

function openQuantityModal(mode, item, maxQuantity) {
  quantityModal.show = true;
  quantityModal.mode = mode;
  quantityModal.item = item;
  quantityModal.maxQuantity = Number(maxQuantity || 0);
  quantityModal.integerOnly = shouldUseIntegerQuantity(mode, item);
  quantityModal.quantity = getDefaultQuantity(mode, item, maxQuantity);
  quantityModal.note = '';
}

function getSlotOccupancy(slot, currentAllocationId = '') {
  const normalizedSlot = normalizeSlot(slot);
  if (!normalizedSlot) return 0;
  return equippedItems.value
    .filter((item) => item.allocation_id !== currentAllocationId && normalizeSlot(item.slot) === normalizedSlot)
    .reduce((sum, item) => sum + Number(item.display_quantity || 0), 0);
}

async function emitChanged(options = {}) {
  emit('changed', {
    reloadCharacters: true,
    reloadItems: true,
    reloadTransactions: Boolean(options.reloadTransactions)
  });
}

function beginEquipItem(item) {
  if (Number(item?.display_quantity || 0) > 1) {
    openQuantityModal('equip', item, item.display_quantity);
    return;
  }
  void equipItem(item, 1);
}

function beginUnequipItem(item) {
  if (Number(item?.display_quantity || 0) > 1) {
    openQuantityModal('unequip', item, item.display_quantity);
    return;
  }
  void unequipItem(item, 1);
}

async function equipItem(item, amount) {
  if (!props.character?.id) return;
  const equipAmount = Number(amount || 0);
  if (!Number.isFinite(equipAmount) || equipAmount <= 0) {
    message.warning('请输入有效装备数量');
    return false;
  }

  const slot = normalizeSlot(item.slot);
  if (slot && slot !== '奇物') {
    const occupied = getSlotOccupancy(slot, item.allocation_id);
    const currentEquipped = Number(item.equipped_quantity || 0);
    const limit = slot === '戒指' ? 2 : 1;
    const nextOccupied = occupied + currentEquipped + equipAmount;
    if (nextOccupied > limit) {
      const confirmed = window.confirm(
        `当前 ${slot} 槽位已占用 ${formatAmount(occupied)} 件，继续装备后将达到 ${formatAmount(nextOccupied)} 件。仍然继续吗？`
      );
      if (!confirmed) return false;
    }
  }

  try {
    await apiRequest(`/api/characters/${props.character.id}/inventory/${item.allocation_id}/equip`, {
      method: 'POST',
      body: { quantity: equipAmount }
    });
    message.success('物品已装备');
    await emitChanged();
    return true;
  } catch (error) {
    message.error(error.message || '装备失败');
    return false;
  }
}

async function unequipItem(item, amount) {
  if (!props.character?.id) return;
  const unequipAmount = Number(amount || 0);
  if (!Number.isFinite(unequipAmount) || unequipAmount <= 0) {
    message.warning('请输入有效卸下数量');
    return false;
  }
  try {
    await apiRequest(`/api/characters/${props.character.id}/inventory/${item.allocation_id}/unequip`, {
      method: 'POST',
      body: { quantity: unequipAmount }
    });
    message.success('物品已放入背包');
    await emitChanged();
    return true;
  } catch (error) {
    message.error(error.message || '脱下失败');
    return false;
  }
}

async function confirmQuantityAction() {
  if (!props.character?.id || !quantityModal.item) return;

  const amount = Number(quantityModal.quantity || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    message.warning('请输入有效数量');
    return;
  }
  if (quantityModal.integerOnly && Math.abs(amount - Math.round(amount)) > 1e-9) {
    message.warning('该操作只允许整数数量');
    return;
  }
  if (amount > Number(quantityModal.maxQuantity || 0) + 1e-9) {
    message.warning('数量超过可操作上限');
    return;
  }

  try {
    if (quantityModal.mode === 'withdraw') {
      await apiRequest(`/api/characters/${props.character.id}/warehouse/${quantityModal.item.id}/withdraw`, {
        method: 'POST',
        body: {
          quantity: amount
        }
      });
      message.success('物品已取出到背包');
      quantityModal.show = false;
      await emitChanged();
      return;
    }

    if (quantityModal.mode === 'equip') {
      const ok = await equipItem(quantityModal.item, amount);
      if (ok) quantityModal.show = false;
      return;
    }

    if (quantityModal.mode === 'unequip') {
      const ok = await unequipItem(quantityModal.item, amount);
      if (ok) quantityModal.show = false;
      return;
    }

    if (quantityModal.mode === 'store') {
      await apiRequest(`/api/characters/${props.character.id}/inventory/${quantityModal.item.allocation_id}/store`, {
        method: 'POST',
        body: { quantity: amount }
      });
      message.success('物品已放回仓库');
      quantityModal.show = false;
      await emitChanged();
      return;
    }

    if (quantityModal.mode === 'consume') {
      await apiRequest(`/api/characters/${props.character.id}/inventory/${quantityModal.item.allocation_id}/consume`, {
        method: 'POST',
        body: {
          quantity: amount,
          note: quantityModal.note || ''
        }
      });
      message.success('物品已消耗并写入流水');
      quantityModal.show = false;
      await emitChanged({ reloadTransactions: true });
    }
  } catch (error) {
    message.error(error.message || '操作失败');
  }
}
</script>

<style scoped>
.inventory-shell {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 8px;
}

.inventory-topbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, rgba(201, 168, 76, 0.08), rgba(88, 72, 160, 0.12));
}

.inventory-summary {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  color: var(--text-secondary);
  font-size: 13px;
}

.inventory-summary strong {
  color: var(--gold);
}

.inventory-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-left: auto;
}

.inventory-grid {
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(320px, 1fr) minmax(320px, 1fr);
  gap: 14px;
  align-items: start;
}

@media (max-width: 1280px) {
  .inventory-grid {
    grid-template-columns: 1fr;
  }
}

.inventory-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 420px;
  padding: 14px;
}

.inventory-panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.inventory-panel-header h4 {
  margin: 0;
  font-size: 16px;
  color: var(--text-bright);
}

.inventory-panel-header p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.panel-count {
  min-width: 28px;
  height: 28px;
  border-radius: 999px;
  display: inline-grid;
  place-items: center;
  background: var(--gold-glow);
  border: 1px solid var(--gold-dim);
  color: var(--gold);
  font-weight: 700;
  font-size: 12px;
}

.inventory-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.inventory-card {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.02);
}

.inventory-card.equipped {
  background: linear-gradient(135deg, rgba(201, 168, 76, 0.08), rgba(201, 168, 76, 0.02));
}

.inventory-card.backpack {
  background: linear-gradient(135deg, rgba(88, 72, 160, 0.1), rgba(88, 72, 160, 0.03));
}

.inventory-card.warehouse {
  background: linear-gradient(135deg, rgba(56, 126, 109, 0.1), rgba(56, 126, 109, 0.03));
}

.inventory-card-main {
  min-width: 0;
  flex: 1;
}

.inventory-card-title-row {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.inventory-name {
  color: var(--text-bright);
  font-size: 14px;
}

.inventory-meta-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}

.muted-inline {
  color: var(--text-muted, var(--text-secondary));
}

.inventory-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.danger-icon-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid rgba(231, 76, 60, 0.28);
  background: rgba(231, 76, 60, 0.08);
  color: #e67e73;
  cursor: pointer;
  display: inline-grid;
  place-items: center;
  font-size: 14px;
  transition: all 0.2s;
}

.danger-icon-btn:hover {
  background: rgba(231, 76, 60, 0.18);
  border-color: rgba(231, 76, 60, 0.52);
  color: #ffb3a7;
}

.inventory-owners {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.owner-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid;
  font-size: 12px;
}

.panel-empty {
  min-height: 180px;
  display: grid;
  place-items: center;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 13px;
}

.quantity-form {
  display: flex;
  flex-direction: column;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 13px;
  color: var(--gold);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
