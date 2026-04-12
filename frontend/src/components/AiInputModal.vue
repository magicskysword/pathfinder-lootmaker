<template>
  <n-modal
    :show="show"
    preset="card"
    :title="title"
    style="max-width: 720px"
    :bordered="false"
    :segmented="{ content: true, footer: true }"
    @update:show="$emit('update:show', $event)"
  >
    <div class="ai-modal-body">
      <!-- Provider selection -->
      <div class="form-row">
        <div class="form-group flex-2">
          <label class="form-label">AI Provider</label>
          <n-select
            v-model:value="local.providerId"
            :options="providerOptions"
            placeholder="选择AI Provider"
          />
        </div>
        <div class="form-group" style="justify-content:flex-end">
          <n-button
            type="primary"
            :loading="loading"
            @click="doParseAi"
            style="margin-top:22px"
          >
            ✦ AI解析
          </n-button>
        </div>
      </div>

      <!-- Text input -->
      <div class="form-group">
        <label class="form-label">输入原始文本</label>
        <n-input
          v-model:value="local.inputText"
          type="textarea"
          placeholder="粘贴文本…"
          :autosize="{ minRows: 4, maxRows: 12 }"
        />
      </div>

      <!-- Image upload -->
      <label class="upload-label">
        <input type="file" accept="image/*" @change="onImage" />
        📎 上传图片 (可选)
      </label>
      <span v-if="local.imageDataUrl" class="image-loaded-hint">✓ 图片已加载</span>

      <!-- Context info for expense mode -->
      <div v-if="expenseContext" class="form-group context-info">
        <label class="form-label">📋 当前库存上下文（已传递给AI）</label>
        <div class="context-preview">{{ expenseContext }}</div>
      </div>

      <!-- Results section -->
      <template v-if="result">
        <hr class="fantasy-divider" />
        <div class="result-section">
          <label class="form-label">解析结果</label>

          <div v-if="isExpenseMode">
            <div v-if="resultSellItems.length" class="parsed-group">
              <div class="parsed-group-title">卖出 / 金币支出项</div>
              <div class="parsed-items">
                <div v-for="(item, idx) in resultSellItems" :key="`sell-${idx}`" class="parsed-item-row">
                  <n-checkbox v-model:checked="item._selected" />
                  <span class="pi-name">{{ item._resolvedName || `#${item.seq}` }}</span>
                  <span class="pi-type">{{ item._resolvedType }}</span>
                  <span class="pi-qty">×{{ item.quantity || 1 }}</span>
                  <span class="pi-price">返还 {{ item.refund_percent ?? 100 }}%</span>
                </div>
              </div>
            </div>

            <div v-if="resultBuyItems.length" class="parsed-group">
              <div class="parsed-group-title">购入物品</div>
              <div class="parsed-items">
                <div v-for="(item, idx) in resultBuyItems" :key="`buy-${idx}`" class="parsed-item-row">
                  <n-checkbox v-model:checked="item._selected" />
                  <span class="pi-name">{{ item.name || '未命名' }}</span>
                  <span class="pi-type">{{ item.type || '其他' }}</span>
                  <span class="pi-qty">×{{ item.quantity || 1 }}</span>
                  <span class="pi-price">{{ item.unit_price || 0 }} gp</span>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="resultItems.length" class="parsed-items">
            <div v-for="(item, idx) in resultItems" :key="idx" class="parsed-item-row">
              <n-checkbox v-model:checked="item._selected" />
              <span class="pi-name">{{ item.name || '未命名' }}</span>
              <span class="pi-type">{{ item.type || '其他' }}</span>
              <span class="pi-qty">×{{ item.quantity || 1 }}</span>
              <span class="pi-price">{{ item.unit_price || 0 }} gp</span>
            </div>
          </div>

          <!-- Raw output toggle -->
          <details class="raw-toggle">
            <summary>查看原始输出</summary>
            <pre class="raw-output">{{ rawText }}</pre>
          </details>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="modal-footer">
        <n-button @click="$emit('update:show', false)">取消</n-button>
        <n-button
          v-if="result"
          type="primary"
          @click="confirmResult"
        >
          ✦ 确认录入选中项
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { NModal, NInput, NSelect, NButton, NCheckbox, useMessage } from 'naive-ui';
import { apiRequest } from '../utils/api';

const props = defineProps({
  show: Boolean,
  title: { type: String, default: '🤖 AI 智能录入' },
  parseEndpoint: { type: String, default: '/api/ai/parse-loot' },
  expenseMode: { type: Boolean, default: false },
  expenseContext: { type: String, default: '' },
  warehouseItems: { type: Array, default: () => [] }
});

const emit = defineEmits(['update:show', 'confirm']);
const message = useMessage();

const providers = ref([]);
const loading = ref(false);
const result = ref(null);
const rawText = ref('');

const local = reactive({
  providerId: '',
  inputText: '',
  imageDataUrl: ''
});

const providerOptions = computed(() =>
  providers.value.map((x) => ({
    label: `${x.name}${x.is_default ? ' (默认)' : ''}`,
    value: x.id
  }))
);

const isExpenseMode = computed(() => props.expenseMode);

const resultItems = computed(() => {
  if (!result.value) return [];
  const raw = result.value.loot_items || result.value.items || [];
  if (isExpenseMode.value && props.warehouseItems.length) {
    return raw.map((x) => {
      const seq = Number(x.seq || 0);
      if (seq > 0 && seq <= props.warehouseItems.length) {
        const wItem = props.warehouseItems[seq - 1];
        return { ...x, _resolvedName: wItem.name, _resolvedType: wItem.type || '其他', _selected: x._selected !== false };
      }
      return { ...x, _resolvedName: `#${seq} (未匹配)`, _resolvedType: '', _selected: x._selected !== false };
    });
  }
  return raw;
});

const resultSellItems = computed(() => {
  if (!result.value || !isExpenseMode.value) return [];
  return resultItems.value;
});

const resultBuyItems = computed(() => {
  if (!result.value || !isExpenseMode.value) return [];
  return result.value.buy_items || [];
});



async function loadProviders() {
  try {
    providers.value = await apiRequest('/api/ai/providers');
    if (!local.providerId && providers.value.length) {
      const def = providers.value.find((x) => x.is_default);
      local.providerId = def?.id || providers.value[0].id;
    }
  } catch (_) {
    providers.value = [];
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

async function onImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    local.imageDataUrl = await fileToDataUrl(file);
    message.success('图片已加载');
  } catch (error) {
    message.error(error.message || '图片处理失败');
  } finally {
    event.target.value = '';
  }
}

async function doParseAi() {
  if (!local.inputText && !local.imageDataUrl) {
    message.warning('请输入文本或上传图片');
    return;
  }
  loading.value = true;
  try {
    const body = {
      providerId: local.providerId || null,
      inputText: local.inputText,
      imageDataUrl: local.imageDataUrl
    };
    if (props.expenseContext) {
      body.inputText = `[当前库存信息]\n${props.expenseContext}\n\n[用户输入]\n${local.inputText}`;
    }
    const data = await apiRequest(props.parseEndpoint, { method: 'POST', body });
    rawText.value = data.raw_text || '';
    const parsed = data.parsed || {};
    const items = (parsed.loot_items || parsed.items || []).map((x) => ({ ...x, _selected: true }));
    const buyItems = (parsed.buy_items || []).map((x) => ({ ...x, _selected: true }));
    result.value = {
      ...parsed,
      loot_items: items,
      items,
      buy_items: buyItems
    };
    message.success('AI解析完成，请确认结果');
  } catch (error) {
    message.error(error.message || 'AI解析失败');
  } finally {
    loading.value = false;
  }
}

function confirmResult() {
  const selectedItems = resultItems.value.filter((x) => x._selected);
  const selectedBuyItems = resultBuyItems.value.filter((x) => x._selected);
  emit('confirm', {
    items: selectedItems,
    buyItems: selectedBuyItems,
    character: result.value?.character || null,
    buffs: result.value?.buffs || [],
    note: result.value?.note || ''
  });
  // Reset
  result.value = null;
  rawText.value = '';
  local.inputText = '';
  local.imageDataUrl = '';
  emit('update:show', false);
}

// Load providers when modal opens
watch(() => props.show, (v) => {
  if (v && !providers.value.length) {
    loadProviders();
  }
  if (v) {
    result.value = null;
    rawText.value = '';
  }
});
</script>

<style scoped>
.ai-modal-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-row {
  display: flex;
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.flex-2 { flex: 2; }

.form-label {
  font-size: 13px;
  color: var(--gold);
  letter-spacing: 0.5px;
}

.upload-label {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  border: 1px dashed var(--border);
  padding: 4px 12px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all 0.2s;
  align-self: flex-start;
}
.upload-label:hover {
  border-color: var(--gold);
  color: var(--gold);
}
.upload-label input { display: none; }

.image-loaded-hint {
  font-size: 12px;
  color: var(--success, #2ecc71);
}

.context-info {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px;
}

.context-preview {
  font-size: 12px;
  color: var(--text-secondary);
  max-height: 120px;
  overflow: auto;
  white-space: pre-wrap;
}

.fantasy-divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: 4px 0;
}

.result-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.parsed-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.parsed-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.parsed-group + .parsed-group {
  margin-top: 8px;
}

.parsed-group-title {
  font-size: 12px;
  color: var(--gold);
  letter-spacing: 0.5px;
}

.parsed-item-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px;
}

.pi-name { font-weight: 600; color: var(--text-bright); flex: 1; }
.pi-type { color: var(--arcane-bright); font-size: 12px; }
.pi-qty { color: var(--gold); }
.pi-price { color: var(--text-secondary); font-size: 12px; }

.raw-toggle {
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
.raw-toggle summary {
  padding: 4px 0;
}

.raw-output {
  margin: 4px 0 0;
  max-height: 200px;
  overflow: auto;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
