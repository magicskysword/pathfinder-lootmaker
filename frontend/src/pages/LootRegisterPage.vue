<template>
  <div class="loot-page">
    <!-- Ambient particles -->
    <div class="ambient-particles">
      <span v-for="i in 12" :key="i" class="particle" :style="{
        left: Math.random() * 100 + '%',
        animationDelay: Math.random() * 8 + 's',
        animationDuration: (6 + Math.random() * 6) + 's',
        '--hue': i % 2 === 0 ? '45' : '265'
      }" />
    </div>

    <h2 class="page-title">💎 数据登记面板</h2>

    <!-- Mode Switch -->
    <div class="mode-switch">
      <n-radio-group v-model:value="mode" size="large">
        <n-radio-button value="loot">📥 Loot模式</n-radio-button>
        <n-radio-button value="expense">💱 交易模式</n-radio-button>
      </n-radio-group>
    </div>

    <!-- ==================== LOOT MODE ==================== -->
    <template v-if="mode === 'loot'">
      <div class="loot-grid">
        <!-- LEFT: Unallocated Item Pool -->
        <div class="loot-main">
          <!-- Toolbar -->
          <div class="ornate-frame toolbar-bar">
            <div class="toolbar-row">
              <n-button type="primary" @click="addLootItem">✦ 新增Loot</n-button>
              <n-button @click="openAiModal">🤖 AI录入</n-button>
              <div class="spacer"></div>
              <n-button quaternary @click="clearLootDraft" class="danger-text">🗑 清空草稿</n-button>
              <n-button type="primary" :loading="publishing" @click="publishLoot">📜 发布Loot</n-button>
            </div>
            <div class="toolbar-hint">
              草稿自动保存于浏览器本地。将左侧物品拖至右侧角色区域可快速分配。
            </div>
          </div>

          <!-- Notes (above pool) -->
          <div class="ornate-frame notes-section">
            <h3 class="section-title">📝 备注</h3>
            <n-input
              v-model:value="lootNote"
              type="textarea"
              placeholder="发布备注（会写入记录）"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
            <n-input
              v-model:value="lootMemoText"
              type="textarea"
              placeholder="纯文本备忘录"
              :autosize="{ minRows: 2, maxRows: 4 }"
              style="margin-top: 8px"
            />
          </div>

          <!-- Unallocated Items Pool -->
          <div
            class="ornate-frame pool-area pool-area-expand"
            @dragover.prevent="poolDragOver = true"
            @dragleave="poolDragOver = false"
            @drop.prevent="onDropToPool"
            :class="{ 'pool-highlight': poolDragOver }"
          >
            <div class="pool-header">
              <h3 class="section-title">📦 未分配物品池</h3>
              <div class="pool-header-right">
                <n-select v-model:value="lootAutoRule" :options="ruleOptions" size="small" style="min-width: 150px" />
                <n-button size="small" @click="autoAssign">⚖ 自动分配</n-button>
                <span class="pool-count">{{ lootUnallocatedItems.length }} 项</span>
              </div>
            </div>
            <table class="fantasy-table loot-table" v-if="lootUnallocatedItems.length">
              <thead>
                <tr>
                  <th style="width:36px">✓</th>
                  <th>名称</th>
                  <th>类型/槽位</th>
                  <th style="width:130px">数量</th>
                  <th style="width:140px">单价(GP)</th>
                  <th style="width:100px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in lootUnallocatedItems"
                  :key="item.client_id"
                  class="loot-row"
                  :class="{ dragging: draggingItem?.client_id === item.client_id }"
                  draggable="true"
                  @dragstart="onDragStartFromPool(item, $event)"
                  @dragend="onDragEnd"
                >
                  <td><n-checkbox v-model:checked="item.selected" /></td>
                  <td>
                    <n-input v-model:value="item.name" placeholder="物品名称" size="small" />
                  </td>
                  <td>
                    <div class="type-slot-cell">
                      <n-select v-model:value="item.type" :options="itemTypeOptions" size="small" style="width:100px" />
                      <n-select
                        v-model:value="item.slot"
                        :options="slotOptions"
                        :disabled="item.type !== '装备'"
                        clearable
                        size="small"
                        style="width:100px"
                      />
                    </div>
                  </td>
                  <td><n-input-number v-model:value="item.quantity" :min="1" size="small" style="width:120px" /></td>
                  <td><n-input-number v-model:value="item.unit_price" :min="0" size="small" style="width:130px" /></td>
                  <td>
                    <div class="row-actions">
                      <button class="icon-btn" title="详细编辑" @click="openItemEdit(item)">📝</button>
                      <button class="icon-btn danger" title="删除" @click="removeLootItem(item.client_id)">🗑</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-hint">
              {{ poolDragOver ? '🎯 松开以放回物品池' : '暂无物品，点击上方「新增」或从右侧拖回' }}
            </div>
          </div>
        </div>

        <!-- RIGHT: Character Allocation -->
        <div class="loot-sidebar">
          <div class="ornate-frame drop-zone-panel">
            <h3 class="section-title">⚔ 角色分配区</h3>
            <div class="drop-cards">
              <div
                v-for="character in plCharacters"
                :key="character.id"
                class="drop-card"
                :class="{ 'drag-over': dragOverCharId === character.id }"
                :style="{ '--char-color': character.color || '#c9a84c' }"
                @dragover.prevent="dragOverCharId = character.id"
                @dragleave="dragOverCharId = ''"
                @drop.prevent="onDropToCharacter(character.id)"
              >
                <div class="dc-header">
                  <div class="dc-avatar" :style="{ borderColor: character.color }">
                    <img v-if="character.portrait_path" :src="character.portrait_path" :alt="character.name" />
                    <span v-else class="avatar-letter">{{ character.name.slice(0, 1) }}</span>
                  </div>
                  <span class="dc-name">{{ character.name }}</span>
                  <span class="dc-value">{{ charAllocValue(character.id).toFixed(1) }} gp</span>
                </div>
                <div class="dc-items">
                  <div
                    v-for="alloc in getCharAllocations(character.id)"
                    :key="alloc.key"
                    class="alloc-item"
                    :style="{ borderColor: character.color, background: (character.color || '#c9a84c') + '18' }"
                    draggable="true"
                    @dragstart="onDragStartFromChar(alloc, character.id, $event)"
                    @dragend="onDragEnd"
                  >
                    <span class="ai-name">{{ alloc.name || '未命名' }}</span>
                    <span class="ai-qty">×{{ alloc.quantity }}</span>
                    <span class="ai-price">{{ alloc.unit_price }} gp</span>
                    <button class="ai-remove" title="移回物品池" @click="deallocate(alloc, character.id)">✕</button>
                  </div>
                  <span v-if="!getCharAllocations(character.id).length" class="empty-alloc">
                    {{ dragOverCharId === character.id ? '🎯 松开以分配' : '拖入物品以分配' }}
                  </span>
                </div>
              </div>
              <div v-if="!plCharacters.length" class="empty-hint" style="padding:20px">暂无PL角色</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ==================== EXPENSE MODE ==================== -->
    <template v-if="mode === 'expense'">
      <div class="expense-layout">
        <!-- LEFT: Trade Editor -->
        <div class="loot-main">
          <div class="ornate-frame toolbar-bar">
            <div class="toolbar-row">
              <n-button type="primary" @click="addExpenseItem">✦ 新增卖出项</n-button>
              <n-button @click="addTradeBuyItem">🛍 新增购入项</n-button>
              <n-button @click="openAiModal">🤖 AI录入</n-button>
              <div class="spacer"></div>
              <n-button quaternary @click="clearExpenseDraft" class="danger-text">🗑 清空草稿</n-button>
              <n-button type="primary" :loading="publishing" @click="publishExpense">📜 确认交易</n-button>
            </div>
            <div class="toolbar-hint">
              交易模式：可从仓库卖出物品并设置返还比例，也可录入新购入的物品。购入项默认勾选「付费」，确认交易时会按数量 × 单价自动扣除仓库金币。
            </div>
          </div>

          <div class="ornate-frame notes-section">
            <h3 class="section-title">📝 备注</h3>
            <n-input
              v-model:value="expenseNote"
              type="textarea"
              placeholder="交易备注（会写入流水记录）"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
            <div class="trade-summary-grid">
              <div class="trade-summary-card">
                <span class="ts-label">总获得 GP</span>
                <strong class="ts-value">{{ formatAmount(expenseRefundTotal) }} gp</strong>
              </div>
              <div class="trade-summary-card">
                <span class="ts-label">总出售返还率</span>
                <strong class="ts-value">{{ formatAmount(expenseOverallPercent) }}%</strong>
              </div>
              <div class="trade-summary-card">
                <span class="ts-label">总购入 GP</span>
                <strong class="ts-value">{{ formatAmount(tradePurchaseTotal) }} gp</strong>
              </div>
              <div class="trade-summary-card">
                <span class="ts-label">自动付费 GP</span>
                <strong class="ts-value">{{ formatAmount(tradeAutomaticPaymentTotal) }} gp</strong>
              </div>
              <div class="trade-summary-card">
                <span class="ts-label">净金币变化</span>
                <strong class="ts-value" :class="{ positive: tradeNetGpDelta >= 0, negative: tradeNetGpDelta < 0 }">
                  {{ tradeNetGpDelta >= 0 ? '+' : '' }}{{ formatAmount(tradeNetGpDelta) }} gp
                </strong>
              </div>
            </div>
          </div>

          <div class="ornate-frame pool-area pool-area-expand">
            <div class="pool-header">
              <h3 class="section-title">📤 卖出 / 金币支出项</h3>
              <span class="pool-count">{{ expenseItems.length }} 项</span>
            </div>
            <table class="fantasy-table loot-table" v-if="expenseItems.length">
              <thead>
                <tr>
                  <th style="width:50px">编号</th>
                  <th>名称 / 仓库选择</th>
                  <th>类型</th>
                  <th style="width:130px">数量</th>
                  <th style="width:140px">单价(GP)</th>
                  <th style="width:120px">返还%</th>
                  <th style="width:100px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in expenseItems"
                  :key="item.client_id"
                  class="loot-row"
                >
                  <td class="expense-seq">{{ item.seq }}</td>
                  <td>
                    <div class="expense-name-cell">
                      <n-select
                        :value="item.warehouse_id || null"
                        :options="warehouseSelectOptions"
                        filterable
                        clearable
                        placeholder="选择仓库物品…"
                        size="small"
                        @update:value="(v) => onSelectWarehouseItem(item, v)"
                        style="min-width: 200px"
                      />
                      <n-input
                        v-model:value="item.name"
                        placeholder="或手动输入名称"
                        size="small"
                        :disabled="!!item.warehouse_id"
                      />
                    </div>
                  </td>
                  <td>
                    <n-select v-model:value="item.type" :options="itemTypeOptions" size="small" style="width:100px" :disabled="!!item.warehouse_id" />
                  </td>
                  <td><n-input-number v-model:value="item.quantity" :min="1" size="small" style="width:120px" /></td>
                  <td><n-input-number v-model:value="item.unit_price" :min="0" size="small" style="width:130px" :disabled="!!item.warehouse_id" /></td>
                  <td>
                    <n-input-number
                      v-model:value="item.refund_percent"
                      :min="0"
                      :max="100"
                      size="small"
                      style="width:110px"
                    />
                  </td>
                  <td>
                    <div class="row-actions">
                      <button class="icon-btn danger" title="删除" @click="removeExpenseItem(item.client_id)">🗑</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-hint">
              暂无卖出项，点击上方「新增卖出项」或使用「AI录入」
            </div>
          </div>

          <div class="ornate-frame pool-area pool-area-expand">
            <div class="pool-header">
              <h3 class="section-title">🛍 购入物品列表</h3>
              <span class="pool-count">{{ tradeBuyItems.length }} 项</span>
            </div>
            <table class="fantasy-table loot-table" v-if="tradeBuyItems.length">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>类型/槽位</th>
                  <th style="width:130px">数量</th>
                  <th style="width:140px">单价(GP)</th>
                  <th style="width:80px">付费</th>
                  <th style="width:100px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in tradeBuyItems"
                  :key="item.client_id"
                  class="loot-row"
                >
                  <td>
                    <n-input v-model:value="item.name" placeholder="物品名称" size="small" />
                  </td>
                  <td>
                    <div class="type-slot-cell">
                      <n-select v-model:value="item.type" :options="itemTypeOptions" size="small" style="width:100px" />
                      <n-select
                        v-model:value="item.slot"
                        :options="slotOptions"
                        :disabled="item.type !== '装备'"
                        clearable
                        size="small"
                        style="width:100px"
                      />
                    </div>
                  </td>
                  <td><n-input-number v-model:value="item.quantity" :min="1" size="small" style="width:120px" /></td>
                  <td><n-input-number v-model:value="item.unit_price" :min="0" size="small" style="width:130px" /></td>
                  <td>
                    <n-checkbox v-model:checked="item.paid" title="取消勾选则只将物品入库，不扣除金币">付费</n-checkbox>
                  </td>
                  <td>
                    <div class="row-actions">
                      <button class="icon-btn" title="详细编辑" @click="openTradeBuyItemEdit(item)">📝</button>
                      <button class="icon-btn danger" title="删除" @click="removeTradeBuyItem(item.client_id)">🗑</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-hint">
              暂无购入项，点击上方「新增购入项」或使用「AI录入」
            </div>
          </div>
        </div>

        <div class="expense-sidebar">
          <div class="ornate-frame warehouse-overview-panel">
            <h3 class="section-title">🏠 仓库卖出预览</h3>
            <div v-if="!warehouseItems.length" class="empty-hint" style="padding:12px">仓库暂无物品</div>
            <div v-else class="warehouse-overview-list">
              <div
                v-for="(wItem, idx) in warehouseOverview"
                :key="wItem.id"
                class="warehouse-overview-row"
                :class="{ 'wo-removed': wItem.removedAll, 'wo-changed': wItem.qtyReduced > 0 && !wItem.removedAll }"
              >
                <span class="wo-seq">#{{ idx + 1 }}</span>
                <span class="wo-name">{{ wItem.name }}</span>
                <span class="wo-type">{{ wItem.type }}</span>
                <span class="wo-qty">
                  <template v-if="wItem.removedAll">
                    <s>×{{ wItem.originalQty }}</s> → 0
                  </template>
                  <template v-else-if="wItem.qtyReduced > 0">
                    ×{{ wItem.originalQty }} → ×{{ wItem.originalQty - wItem.qtyReduced }}
                    <span class="wo-diff">(-{{ wItem.qtyReduced }})</span>
                  </template>
                  <template v-else>
                    ×{{ wItem.originalQty }}
                  </template>
                </span>
                <span class="wo-price">{{ wItem.unit_price }}gp</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ===== Modals ===== -->

    <!-- AI Input Modal -->
    <AiInputModal
      v-model:show="aiModalShow"
      :parse-endpoint="mode === 'expense' ? '/api/ai/parse-expense' : '/api/ai/parse-loot'"
      :expense-mode="mode === 'expense'"
      :expense-context="mode === 'expense' ? inventoryContext : ''"
      :warehouse-items="mode === 'expense' ? warehouseItems : []"
      @confirm="onAiConfirm"
    />

    <!-- Split Quantity Modal -->
    <SplitQuantityModal
      v-model:show="splitModalShow"
      :item-name="splitModalItem?.name || ''"
      :max-quantity="splitModalMaxQty"
      @confirm="onSplitConfirm"
    />

    <!-- Item Detail Edit Modal -->
    <ItemEditModal
      v-model:show="itemEditShow"
      :item="itemEditData"
      @save="onItemEditSave"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import {
  NButton,
  NSelect,
  NCheckbox,
  NInput,
  NInputNumber,
  NRadioGroup,
  NRadioButton,
  useMessage
} from 'naive-ui';
import { apiRequest } from '../utils/api';
import AiInputModal from '../components/AiInputModal.vue';
import SplitQuantityModal from '../components/SplitQuantityModal.vue';
import ItemEditModal from '../components/ItemEditModal.vue';

const message = useMessage();

// Separate draft keys for each mode
const lootDraftKey = 'loot-register-draft-loot-v3';
const expenseDraftKey = 'loot-register-draft-expense-v3';

const mode = ref('loot');

const itemTypeOptions = [
  { label: '装备', value: '装备' },
  { label: '药水', value: '药水' },
  { label: '卷轴', value: '卷轴' },
  { label: '金钱', value: '金钱' },
  { label: '其他', value: '其他' }
];

const slotOptions = [
  '主手', '副手', '盔甲', '盾牌', '披风', '腰带', '头环', '头部',
  '护符', '戒指1', '戒指2', '腕部', '胸部', '躯体', '眼睛', '脚部', '手套', '手臂', '奇物'
].map((x) => ({ label: x, value: x }));

const ruleOptions = [
  { label: '⚖ 平均分', value: 'average' },
  { label: '💰 按价值', value: 'value' },
  { label: '⚔ 按角色权重', value: 'weight' },
  { label: '🎲 随机', value: 'random' },
  { label: '🔄 轮流', value: 'round' }
];

// ======================== SHARED STATE ========================
const plCharacters = ref([]);
const publishing = ref(false);
const warehouseItems = ref([]);

// AI modal
const aiModalShow = ref(false);
const inventoryContext = ref('');

// Split modal
const splitModalShow = ref(false);
const splitModalItem = ref(null);
const splitModalMaxQty = ref(1);
const splitPendingTarget = ref('');

// Item edit modal
const itemEditShow = ref(false);
const itemEditData = ref(null);

// Drag state (loot mode only)
const draggingItem = ref(null);
const draggingSource = ref('');
const dragOverCharId = ref('');
const poolDragOver = ref(false);

// ======================== LOOT MODE STATE ========================
const lootItems = ref([]);
const lootNote = ref('');
const lootMemoText = ref('');
const lootAutoRule = ref('average');

// ======================== EXPENSE MODE STATE ========================
const expenseItems = ref([]);
const tradeBuyItems = ref([]);
const expenseNote = ref('');
let expenseSeqCounter = 1;

// ======================== UTILS ========================
function uid() {
  return `draft_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function nextExpenseSeq() {
  return expenseSeqCounter++;
}

function formatAmount(value) {
  const raw = Number(value || 0);
  const num = Math.abs(raw) < 1e-9 ? 0 : raw;
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function clampRefundPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 100;
  return Math.min(100, Math.max(0, num));
}

// ======================== LOOT MODE FUNCTIONS ========================
function newLootItem() {
  return {
    client_id: uid(),
    selected: true,
    name: '',
    type: '其他',
    slot: null,
    quantity: 1,
    unit_price: 0,
    weight: 0,
    description: '',
    display_description: '',
    allocated_to: ''
  };
}

const lootUnallocatedItems = computed(() =>
  lootItems.value.filter((x) => !x.allocated_to)
);

function getCharAllocations(characterId) {
  return lootItems.value
    .filter((x) => x.allocated_to === characterId)
    .map((x) => ({
      key: x.client_id,
      client_id: x.client_id,
      name: x.name,
      quantity: x.quantity,
      unit_price: x.unit_price,
      type: x.type
    }));
}

function charAllocValue(characterId) {
  return lootItems.value
    .filter((x) => x.allocated_to === characterId)
    .reduce((sum, x) => sum + (x.quantity * x.unit_price), 0);
}

function addLootItem() {
  lootItems.value.push(newLootItem());
}

function removeLootItem(clientId) {
  lootItems.value = lootItems.value.filter((x) => x.client_id !== clientId);
}

// Drag & Drop (loot mode)
function onDragStartFromPool(item, event) {
  draggingItem.value = item;
  draggingSource.value = 'pool';
  event.dataTransfer.effectAllowed = 'move';
}

function onDragStartFromChar(alloc, characterId, event) {
  const item = lootItems.value.find((x) => x.client_id === alloc.client_id);
  draggingItem.value = item || null;
  draggingSource.value = `char:${characterId}`;
  event.dataTransfer.effectAllowed = 'move';
}

function onDragEnd() {
  draggingItem.value = null;
  draggingSource.value = '';
  dragOverCharId.value = '';
  poolDragOver.value = false;
}

function onDropToCharacter(characterId) {
  dragOverCharId.value = '';
  if (!draggingItem.value) return;
  if (draggingItem.value.allocated_to === characterId) return;

  const item = draggingItem.value;
  if (item.quantity > 1 && draggingSource.value === 'pool') {
    splitModalItem.value = item;
    splitModalMaxQty.value = item.quantity;
    splitPendingTarget.value = characterId;
    splitModalShow.value = true;
    return;
  }

  item.allocated_to = characterId;
  draggingItem.value = null;
  draggingSource.value = '';
}

function onDropToPool() {
  poolDragOver.value = false;
  if (!draggingItem.value) return;
  if (!draggingItem.value.allocated_to) return;
  draggingItem.value.allocated_to = '';
  draggingItem.value = null;
  draggingSource.value = '';
}

function onSplitConfirm(splitQty) {
  if (!splitModalItem.value || !splitPendingTarget.value) return;
  const item = splitModalItem.value;
  const targetChar = splitPendingTarget.value;

  if (splitQty >= item.quantity) {
    item.allocated_to = targetChar;
  } else {
    item.quantity -= splitQty;
    lootItems.value.push({
      ...item,
      client_id: uid(),
      quantity: splitQty,
      allocated_to: targetChar
    });
  }

  splitModalItem.value = null;
  splitPendingTarget.value = '';
  draggingItem.value = null;
  draggingSource.value = '';
}

function deallocate(alloc, characterId) {
  const item = lootItems.value.find((x) => x.client_id === alloc.client_id);
  if (!item) return;
  const poolItem = lootUnallocatedItems.value.find(
    (x) => x.name === item.name && x.type === item.type && x.unit_price === item.unit_price
  );
  if (poolItem) {
    poolItem.quantity += item.quantity;
    lootItems.value = lootItems.value.filter((x) => x.client_id !== item.client_id);
  } else {
    item.allocated_to = '';
  }
}

// Item Edit
function openItemEdit(item) {
  itemEditData.value = { ...item };
  itemEditShow.value = true;
}

function onItemEditSave(data) {
  const item = lootItems.value.find((x) => x.client_id === data.client_id)
    || tradeBuyItems.value.find((x) => x.client_id === data.client_id);
  if (item) {
    Object.assign(item, data);
  }
  itemEditShow.value = false;
}

// Auto Assign (loot mode)
async function autoAssign() {
  const selected = lootUnallocatedItems.value.filter((x) => x.selected);
  if (!selected.length) {
    message.warning('请先勾选要自动分配的物品');
    return;
  }
  try {
    const res = await apiRequest('/api/loot-records/auto-assign', {
      method: 'POST',
      body: {
        rule: lootAutoRule.value,
        lootItems: selected.map((x) => ({
          client_id: x.client_id,
          name: x.name,
          quantity: Number(x.quantity || 0),
          unit_price: Number(x.unit_price || 0)
        }))
      }
    });
    for (const assign of res.assignments || []) {
      const item = lootItems.value.find((x) => x.client_id === assign.client_id);
      if (!item) continue;
      const allocs = assign.allocations || [];
      if (allocs.length === 1) {
        item.allocated_to = allocs[0].characterId;
        item.quantity = Number(allocs[0].quantity || item.quantity);
      } else if (allocs.length > 1) {
        const first = allocs[0];
        item.allocated_to = first.characterId;
        item.quantity = Number(first.quantity || 1);
        for (let i = 1; i < allocs.length; i++) {
          lootItems.value.push({
            ...item,
            client_id: uid(),
            allocated_to: allocs[i].characterId,
            quantity: Number(allocs[i].quantity || 1)
          });
        }
      }
    }
    message.success('已生成自动分配，可拖动调整');
  } catch (error) {
    message.error(error.message || '自动分配失败');
  }
}

// Publish Loot
async function publishLoot() {
  const allItems = lootItems.value;
  if (!allItems.length) {
    message.warning('请先添加物品');
    return;
  }
  for (const item of allItems) {
    if (!item.name) {
      message.warning('存在未填写名称的物品');
      return;
    }
    if (Number(item.quantity || 0) <= 0) {
      message.warning(`物品 ${item.name} 数量必须大于0`);
      return;
    }
  }
  publishing.value = true;
  try {
    const publishItems = [];
    for (const item of allItems) {
      const existing = publishItems.find(
        (x) => x.name === item.name && x.type === item.type && x.unit_price === item.unit_price && !item.allocated_to && !x.allocations.length
      );
      if (existing && !item.allocated_to && !existing.allocations.length) {
        existing.quantity += item.quantity;
      } else if (item.allocated_to) {
        const existingAlloc = publishItems.find(
          (x) => x.name === item.name && x.type === item.type && x.unit_price === item.unit_price
        );
        if (existingAlloc) {
          const foundAlloc = existingAlloc.allocations.find((a) => a.characterId === item.allocated_to);
          if (foundAlloc) {
            foundAlloc.quantity += item.quantity;
          } else {
            existingAlloc.allocations.push({ characterId: item.allocated_to, quantity: item.quantity });
          }
          existingAlloc.quantity += item.quantity;
        } else {
          publishItems.push({
            name: item.name, type: item.type, slot: item.slot,
            quantity: item.quantity, unit_price: Number(item.unit_price || 0),
            weight: Number(item.weight || 0), description: item.description || '',
            display_description: item.display_description || '',
            allocations: [{ characterId: item.allocated_to, quantity: item.quantity }]
          });
        }
      } else {
        publishItems.push({
          name: item.name, type: item.type, slot: item.slot,
          quantity: item.quantity, unit_price: Number(item.unit_price || 0),
          weight: Number(item.weight || 0), description: item.description || '',
          display_description: item.display_description || '',
          allocations: []
        });
      }
    }

    await apiRequest('/api/loot-records/publish', {
      method: 'POST',
      body: {
        lootItems: publishItems,
        goldItems: [],
        distribution: { rule: lootAutoRule.value },
        note: lootNote.value,
        memo_text: lootMemoText.value,
        mode: 'loot'
      }
    });
    clearLootDraft();
    message.success('Loot发布成功');
  } catch (error) {
    message.error(error.message || '发布失败');
  } finally {
    publishing.value = false;
  }
}

// ======================== EXPENSE MODE FUNCTIONS ========================

const warehouseSelectOptions = computed(() =>
  warehouseItems.value.map((x, idx) => ({
    label: `#${idx + 1} ${x.name} (${x.type}) ×${x.quantity} ${x.unit_price}gp`,
    value: x.id
  }))
);

const warehouseOverview = computed(() => {
  const expenseMap = {};
  for (const item of expenseItems.value) {
    if (item.warehouse_id) {
      expenseMap[item.warehouse_id] = (expenseMap[item.warehouse_id] || 0) + Number(item.quantity || 0);
    }
  }
  return warehouseItems.value.map((w) => {
    const originalQty = Number(w.quantity || 0);
    const expensedQty = expenseMap[w.id] || 0;
    return {
      id: w.id,
      name: w.name,
      type: w.type,
      unit_price: w.unit_price,
      originalQty,
      qtyReduced: Math.min(expensedQty, originalQty),
      removedAll: expensedQty >= originalQty && expensedQty > 0
    };
  });
});

const expenseSellBaseTotal = computed(() => expenseItems.value.reduce((sum, item) => {
  if ((item.type || '') === '金钱') return sum;
  return sum + Math.abs(Number(item.quantity || 0)) * Math.abs(Number(item.unit_price || 0));
}, 0));

const expenseRefundTotal = computed(() => expenseItems.value.reduce((sum, item) => {
  if ((item.type || '') === '金钱') return sum;
  const base = Math.abs(Number(item.quantity || 0)) * Math.abs(Number(item.unit_price || 0));
  return sum + base * (clampRefundPercent(item.refund_percent) / 100);
}, 0));

const expenseOverallPercent = computed(() => {
  const base = expenseSellBaseTotal.value;
  if (base <= 0) return 0;
  return (expenseRefundTotal.value / base) * 100;
});

const tradePurchaseTotal = computed(() => tradeBuyItems.value.reduce(
  (sum, item) => sum + Math.abs(Number(item.quantity || 0)) * Math.abs(Number(item.unit_price || 0)),
  0
));

const tradeAutomaticPaymentTotal = computed(() => tradeBuyItems.value.reduce((sum, item) => {
  if (item.paid === false) return sum;
  return sum + Math.abs(Number(item.quantity || 0)) * Math.abs(Number(item.unit_price || 0));
}, 0));

const tradeSpentGoldTotal = computed(() => expenseItems.value
  .filter((item) => (item.type || '') === '金钱')
  .reduce((sum, item) => sum + Math.abs(Number(item.quantity || 0)) * Math.abs(Number(item.unit_price || 0)), 0));

const tradeNetGpDelta = computed(() => (
  expenseRefundTotal.value - tradeSpentGoldTotal.value - tradeAutomaticPaymentTotal.value
));

function newExpenseItem() {
  return {
    client_id: uid(),
    seq: nextExpenseSeq(),
    name: '',
    type: '其他',
    quantity: 1,
    unit_price: 0,
    warehouse_id: '',
    refund_percent: 100
  };
}

function newTradeBuyItem() {
  return {
    client_id: uid(),
    name: '',
    type: '其他',
    slot: null,
    quantity: 1,
    unit_price: 0,
    paid: true,
    weight: 0,
    description: '',
    display_description: ''
  };
}

function addExpenseItem() {
  expenseItems.value.push(newExpenseItem());
}

function addTradeBuyItem() {
  tradeBuyItems.value.push(newTradeBuyItem());
}

function removeExpenseItem(clientId) {
  expenseItems.value = expenseItems.value.filter((x) => x.client_id !== clientId);
}

function removeTradeBuyItem(clientId) {
  tradeBuyItems.value = tradeBuyItems.value.filter((x) => x.client_id !== clientId);
}

function openTradeBuyItemEdit(item) {
  itemEditData.value = { ...item };
  itemEditShow.value = true;
}

function onSelectWarehouseItem(expenseItem, warehouseId) {
  if (!warehouseId) {
    expenseItem.warehouse_id = '';
    expenseItem.name = '';
    expenseItem.type = '其他';
    expenseItem.unit_price = 0;
    expenseItem.refund_percent = 100;
    return;
  }
  const wItem = warehouseItems.value.find((x) => x.id === warehouseId);
  if (wItem) {
    expenseItem.warehouse_id = wItem.id;
    expenseItem.name = wItem.name;
    expenseItem.type = wItem.type;
    expenseItem.unit_price = Number(wItem.unit_price || 0);
    expenseItem.quantity = Math.min(expenseItem.quantity || 1, Number(wItem.quantity));
    if ((wItem.type || '') === '金钱') {
      expenseItem.refund_percent = 0;
    } else if (expenseItem.refund_percent == null || Number.isNaN(Number(expenseItem.refund_percent))) {
      expenseItem.refund_percent = 100;
    }
  }
}

async function publishExpense() {
  if (!expenseItems.value.length && !tradeBuyItems.value.length) {
    message.warning('请至少添加卖出项或购入项');
    return;
  }
  for (const item of expenseItems.value) {
    if (!item.name) {
      message.warning('存在未填写名称的卖出项');
      return;
    }
    if (Number(item.quantity || 0) <= 0) {
      message.warning(`卖出项 ${item.name} 数量必须大于0`);
      return;
    }
  }
  for (const item of tradeBuyItems.value) {
    if (!item.name) {
      message.warning('存在未填写名称的购入项');
      return;
    }
    if (Number(item.quantity || 0) <= 0) {
      message.warning(`购入项 ${item.name} 数量必须大于0`);
      return;
    }
  }

  publishing.value = true;
  try {
    const sellItems = expenseItems.value.map((x) => ({
      name: x.name,
      type: x.type,
      quantity: Math.abs(Number(x.quantity || 0)),
      unit_price: Math.abs(Number(x.unit_price || 0)),
      warehouse_id: x.warehouse_id || '',
      refund_percent: clampRefundPercent(x.refund_percent)
    }));
    const buyItems = tradeBuyItems.value.map((x) => ({
      name: x.name,
      type: x.type,
      slot: x.type === '装备' ? x.slot || null : null,
      quantity: Math.abs(Number(x.quantity || 0)),
      unit_price: Math.abs(Number(x.unit_price || 0)),
      paid: x.paid !== false,
      weight: Math.abs(Number(x.weight || 0)),
      description: x.description || '',
      display_description: x.display_description || '',
      allocations: []
    }));

    await apiRequest('/api/loot-records/publish', {
      method: 'POST',
      body: {
        lootItems: sellItems,
        buyItems,
        goldItems: [],
        distribution: {},
        note: expenseNote.value,
        memo_text: '',
        mode: 'trade'
      }
    });
    clearExpenseDraft();
    await loadWarehouseItems();
    message.success('交易记录完成');
  } catch (error) {
    message.error(error.message || '交易失败');
  } finally {
    publishing.value = false;
  }
}

// ======================== AI ========================
async function openAiModal() {
  if (mode.value === 'expense') {
    try {
      const items = await apiRequest('/api/items');
      warehouseItems.value = items;
      inventoryContext.value = items
        .map((x, idx) => `#${idx + 1} ${x.name} ×${x.quantity}`)
        .join('\n');
    } catch (_) {
      inventoryContext.value = '';
    }
  } else {
    inventoryContext.value = '';
  }
  aiModalShow.value = true;
}

function onAiConfirm(result) {
  const items = result.items || [];
  const buyItems = result.buyItems || [];
  if (mode.value === 'expense') {
    for (const x of items) {
      const seq = Number(x.seq || 0);
      const qty = Math.abs(Number(x.quantity || 1));
      if (seq > 0 && seq <= warehouseItems.value.length) {
        const wItem = warehouseItems.value[seq - 1];
        const newItem = newExpenseItem();
        newItem.warehouse_id = wItem.id;
        newItem.name = wItem.name;
        newItem.type = wItem.type || '其他';
        newItem.quantity = Math.min(qty, Number(wItem.quantity || qty));
        newItem.unit_price = Number(wItem.unit_price || 0);
        newItem.refund_percent = (wItem.type || '') === '金钱'
          ? 0
          : clampRefundPercent(x.refund_percent);
        expenseItems.value.push(newItem);
      }
    }
    for (const x of buyItems) {
      const newItem = newTradeBuyItem();
      newItem.name = x.name || '';
      newItem.type = x.type || '其他';
      newItem.slot = x.type === '装备' ? (x.slot || null) : null;
      newItem.quantity = Math.abs(Number(x.quantity || 1));
      newItem.unit_price = Math.abs(Number(x.unit_price || 0));
      newItem.weight = Math.abs(Number(x.weight || 0));
      newItem.description = x.description || '';
      newItem.display_description = x.display_description || '';
      tradeBuyItems.value.push(newItem);
    }
    if (result.note && !expenseNote.value) {
      expenseNote.value = result.note;
    }
  } else {
    for (const x of items) {
      lootItems.value.push({
        client_id: uid(),
        selected: true,
        name: x.name || '',
        type: x.type || '其他',
        slot: x.slot || null,
        quantity: Number(x.quantity || 1),
        unit_price: Number(x.unit_price || 0),
        weight: Number(x.weight || 0),
        description: x.description || '',
        display_description: x.display_description || '',
        allocated_to: ''
      });
    }
    if (result.note && !lootNote.value) {
      lootNote.value = result.note;
    }
  }
  if (items.length || buyItems.length) {
    message.success('AI内容已追加到草稿');
  }
}

// ======================== DRAFT PERSISTENCE ========================

// Loot draft
function serializeLootDraft() {
  return {
    lootItems: lootItems.value,
    note: lootNote.value,
    memoText: lootMemoText.value,
    autoRule: lootAutoRule.value
  };
}

function loadLootDraft() {
  const text = localStorage.getItem(lootDraftKey);
  if (!text) return false;
  try {
    const parsed = JSON.parse(text);
    lootItems.value = Array.isArray(parsed.lootItems) ? parsed.lootItems : [];
    lootNote.value = parsed.note || '';
    lootMemoText.value = parsed.memoText || '';
    lootAutoRule.value = parsed.autoRule || 'average';
    return true;
  } catch (_) {
    return false;
  }
}

function clearLootDraft() {
  lootItems.value = [];
  lootNote.value = '';
  lootMemoText.value = '';
  lootAutoRule.value = 'average';
  localStorage.removeItem(lootDraftKey);
  message.success('Loot草稿已清空');
}

// Expense draft
function serializeExpenseDraft() {
  return {
    expenseItems: expenseItems.value,
    tradeBuyItems: tradeBuyItems.value,
    note: expenseNote.value,
    seqCounter: expenseSeqCounter
  };
}

function normalizeExpenseDraftItem(item) {
  return {
    client_id: uid(),
    seq: 0,
    name: '',
    type: '其他',
    quantity: 1,
    unit_price: 0,
    warehouse_id: '',
    refund_percent: 100,
    ...item,
    refund_percent: clampRefundPercent(item?.refund_percent)
  };
}

function normalizeTradeBuyDraftItem(item) {
  return {
    client_id: uid(),
    name: '',
    type: '其他',
    slot: null,
    quantity: 1,
    unit_price: 0,
    weight: 0,
    description: '',
    display_description: '',
    ...item,
    paid: item?.paid !== false
  };
}

function loadExpenseDraft() {
  const text = localStorage.getItem(expenseDraftKey);
  if (!text) return false;
  try {
    const parsed = JSON.parse(text);
    expenseItems.value = Array.isArray(parsed.expenseItems)
      ? parsed.expenseItems.map(normalizeExpenseDraftItem)
      : [];
    tradeBuyItems.value = Array.isArray(parsed.tradeBuyItems)
      ? parsed.tradeBuyItems.map(normalizeTradeBuyDraftItem)
      : [];
    expenseNote.value = parsed.note || '';
    expenseSeqCounter = parsed.seqCounter || (expenseItems.value.length + 1);
    return true;
  } catch (_) {
    return false;
  }
}

function clearExpenseDraft() {
  expenseItems.value = [];
  tradeBuyItems.value = [];
  expenseNote.value = '';
  expenseSeqCounter = 1;
  localStorage.removeItem(expenseDraftKey);
  message.success('交易草稿已清空');
}

// ======================== DATA LOADING ========================
async function loadCharacters() {
  const rows = await apiRequest('/api/characters');
  plCharacters.value = rows.filter((x) => x.role === 'PL');
}

async function loadWarehouseItems() {
  try {
    warehouseItems.value = await apiRequest('/api/items');
  } catch (_) {
    warehouseItems.value = [];
  }
}

// ======================== WATCHERS ========================
watch(
  () => serializeLootDraft(),
  (value) => {
    localStorage.setItem(lootDraftKey, JSON.stringify(value));
  },
  { deep: true }
);

watch(
  () => serializeExpenseDraft(),
  (value) => {
    localStorage.setItem(expenseDraftKey, JSON.stringify(value));
  },
  { deep: true }
);

watch(mode, (newMode) => {
  if (newMode === 'expense') {
    loadWarehouseItems();
  }
});

onMounted(async () => {
  const lootLoaded = loadLootDraft();
  loadExpenseDraft();
  await loadCharacters();
  if (!lootLoaded && !lootItems.value.length) {
    addLootItem();
  }
  if (mode.value === 'expense') {
    await loadWarehouseItems();
  }
});
</script>

<style scoped>
.loot-page { position: relative; }

.mode-switch {
  margin-bottom: 16px;
  display: flex;
  justify-content: center;
}

.loot-grid {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 20px;
  align-items: start;
}
@media (max-width: 1100px) {
  .loot-grid { grid-template-columns: 1fr; }
}

.expense-layout {
  display: grid;
  grid-template-columns: 1fr 350px;
  gap: 20px;
  align-items: start;
}
@media (max-width: 1100px) {
  .expense-layout { grid-template-columns: 1fr; }
}

/* Toolbar */
.toolbar-bar { margin-bottom: 16px; }
.toolbar-row {
  display: flex; flex-wrap: wrap; gap: 8px;
  align-items: center; margin-bottom: 6px;
}
.spacer { flex: 1; }
.toolbar-hint { font-size: 12px; color: var(--text-secondary); opacity: 0.7; }
.danger-text { color: var(--danger) !important; }

/* Pool area */
.pool-area { padding: 12px; margin-bottom: 16px; transition: all 0.3s; }
.pool-area-expand { overflow: visible; }
.pool-highlight { border-color: var(--gold) !important; background: var(--gold-glow) !important; }
.pool-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.pool-count { font-size: 12px; color: var(--text-secondary); }
.pool-header-right { display: flex; align-items: center; gap: 8px; }

/* Table */
.loot-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.loot-table thead th {
  text-align: left; padding: 8px 6px;
  font-family: 'Cinzel', 'LXGW WenKai', serif;
  color: var(--gold); font-size: 12px; letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border); white-space: nowrap;
}
.loot-table tbody td {
  padding: 6px; border-bottom: 1px solid var(--border-dim); vertical-align: middle;
}
.loot-row { transition: background 0.2s; cursor: grab; }
.loot-row:hover { background: var(--gold-glow); }
.loot-row.dragging { opacity: 0.5; background: var(--arcane-glow); }
.type-slot-cell { display: flex; flex-direction: column; gap: 4px; }
.row-actions { display: flex; gap: 4px; }

.icon-btn {
  background: transparent; border: 1px solid var(--border);
  color: var(--text-primary); width: 28px; height: 28px;
  border-radius: var(--radius); cursor: pointer; font-size: 13px;
  display: inline-grid; place-items: center; transition: all 0.2s;
}
.icon-btn:hover { border-color: var(--gold); background: var(--gold-glow); }
.icon-btn.danger:hover { border-color: var(--danger); background: var(--danger-soft); }

.empty-hint {
  text-align: center; padding: 24px; color: var(--text-secondary); font-style: italic;
}

/* Notes */
.notes-section { margin-bottom: 16px; }
.trade-summary-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}
@media (max-width: 1100px) {
  .trade-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .trade-summary-grid { grid-template-columns: 1fr; }
}
.trade-summary-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elevated);
}
.ts-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.ts-value {
  font-size: 16px;
  color: var(--gold);
}
.ts-value.positive { color: var(--success, #2ecc71); }
.ts-value.negative { color: var(--danger); }

/* Sidebar */
.loot-sidebar { display: flex; flex-direction: column; gap: 16px; }

/* Drop Zone */
.drop-zone-panel { padding: 16px; }
.drop-cards { display: flex; flex-direction: column; gap: 10px; }
.drop-card {
  border: 2px dashed var(--border); border-radius: 10px;
  padding: 12px; transition: all 0.3s; background: var(--bg-card);
}
.drop-card:hover,
.drop-card.drag-over {
  border-color: var(--char-color, var(--gold));
  background: color-mix(in srgb, var(--char-color, var(--gold)) 8%, transparent);
  box-shadow: 0 0 16px color-mix(in srgb, var(--char-color, var(--gold)) 20%, transparent);
}

.dc-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.dc-avatar {
  width: 36px; height: 36px; border-radius: 50%; border: 2px solid var(--gold);
  overflow: hidden; display: grid; place-items: center; background: var(--bg-elevated); flex-shrink: 0;
}
.dc-avatar img { width: 100%; height: 100%; object-fit: cover; }
.avatar-letter {
  font-family: 'Cinzel', serif; font-size: 16px; font-weight: 700; color: var(--gold);
}
.dc-name { font-weight: 600; color: var(--text-bright); font-size: 15px; flex: 1; }
.dc-value { font-size: 13px; color: var(--gold); font-weight: 600; }

.dc-items { display: flex; flex-direction: column; gap: 4px; }
.alloc-item {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px; border-radius: 8px; font-size: 12px;
  border: 1px solid; cursor: grab; transition: all 0.2s;
}
.alloc-item:hover { opacity: 0.85; }
.ai-name { flex: 1; font-weight: 500; }
.ai-qty { color: var(--gold); }
.ai-price { color: var(--text-secondary); font-size: 11px; }
.ai-remove {
  background: transparent; border: none; color: var(--text-secondary);
  cursor: pointer; font-size: 12px; padding: 2px 4px; border-radius: 4px;
  transition: all 0.2s;
}
.ai-remove:hover { color: var(--danger); background: var(--danger-soft); }
.empty-alloc {
  font-size: 12px; color: var(--text-secondary); opacity: 0.5;
  font-style: italic; padding: 4px;
}

/* Expense mode specific */
.expense-seq {
  font-family: 'Cinzel', serif;
  color: var(--gold);
  font-weight: 700;
  text-align: center;
}
.expense-name-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Expense Sidebar */
.expense-sidebar { display: flex; flex-direction: column; gap: 16px; }
.warehouse-overview-panel { padding: 16px; }
.warehouse-overview-list { display: flex; flex-direction: column; gap: 2px; }
.warehouse-overview-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: var(--radius);
  font-size: 12px; border-bottom: 1px solid var(--border-dim);
  transition: all 0.3s;
}
.warehouse-overview-row:last-child { border-bottom: none; }
.warehouse-overview-row.wo-removed {
  opacity: 0.45;
  text-decoration: line-through;
  color: var(--text-dim);
}
.warehouse-overview-row.wo-changed {
  background: rgba(201, 168, 76, 0.08);
  border-color: var(--gold-dim);
}
.wo-seq { color: var(--gold); font-weight: 700; font-family: 'Cinzel', serif; min-width: 28px; }
.wo-name { flex: 1; font-weight: 500; color: var(--text-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wo-type { color: var(--arcane-bright); font-size: 11px; min-width: 32px; }
.wo-qty { color: var(--gold); min-width: 80px; text-align: right; }
.wo-diff { color: var(--danger); font-weight: 600; }
.wo-price { color: var(--text-secondary); font-size: 11px; min-width: 50px; text-align: right; }

/* Ambient particles */
.ambient-particles { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.particle {
  position: absolute; bottom: -10px; width: 3px; height: 3px; border-radius: 50%;
  background: hsla(var(--hue, 45), 70%, 60%, 0.5);
  box-shadow: 0 0 6px hsla(var(--hue, 45), 70%, 60%, 0.3);
  animation: particleFloat linear infinite;
}
@keyframes particleFloat {
  0% { transform: translateY(0) scale(1); opacity: 0; }
  10% { opacity: 0.6; }
  90% { opacity: 0.3; }
  100% { transform: translateY(-100vh) scale(0.3); opacity: 0; }
}
</style>
