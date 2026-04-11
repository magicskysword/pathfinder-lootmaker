<template>
  <div class="data-page">
    <h2 class="page-title">📜 总数据管理</h2>

    <n-tabs v-model:value="activeTab" type="segment" animated>
      <!-- ===== TAB 1: 仓库数据 ===== -->
      <n-tab-pane name="warehouse" tab="📦 仓库数据">
        <div class="tab-content">
          <!-- Toolbar -->
          <div class="action-bar">
            <n-button type="primary" @click="openItemModal(null)">✦ 新建物品</n-button>
            <n-button @click="aiModalShow = true; aiParseEndpoint = '/api/ai/parse-loot'">🤖 AI录入物品</n-button>
            <div class="spacer"></div>
            <n-input
              v-model:value="warehouseFilter.keyword"
              placeholder="🔍 搜索名称…"
              clearable
              size="small"
              style="width: 180px"
            />
            <n-select
              v-model:value="warehouseFilter.type"
              :options="typeFilterOptions"
              size="small"
              style="width: 120px"
            />
            <n-select
              v-model:value="warehouseFilter.assignment"
              :options="assignmentFilterOptions"
              size="small"
              style="width: 240px"
            />
            <n-select
              v-model:value="warehouseFilter.matchMode"
              :options="matchModeOptions"
              size="small"
              style="width: 170px"
            />
            <n-select
              v-model:value="warehouseFilter.sort"
              :options="sortOptions"
              size="small"
              style="width: 170px"
            />
            <n-button
              v-if="selectedItemIds.length"
              size="small"
              @click="openBatchTypeModal"
            >
              🏷 批量改类型 ({{ selectedItemIds.length }})
            </n-button>
            <n-button
              v-if="selectedItemIds.length >= 2"
              size="small"
              @click="openMergeModal"
            >
              🧬 合并选中 ({{ selectedItemIds.length }})
            </n-button>
            <n-button
              v-if="selectedItemIds.length"
              type="error"
              size="small"
              @click="batchDeleteItems"
            >
              🗑 删除选中 ({{ selectedItemIds.length }})
            </n-button>
          </div>

          <!-- Table -->
          <div class="table-wrap">
            <table class="fantasy-table items-table">
              <thead>
                <tr>
                  <th style="width:36px">
                    <n-checkbox
                      :checked="allItemsSelected"
                      :indeterminate="someItemsSelected"
                      @update:checked="toggleSelectAll"
                    />
                  </th>
                  <th>名称</th>
                  <th>类型/槽位</th>
                  <th style="width:70px">数量</th>
                  <th style="width:80px">单价</th>
                  <th style="width:70px">重量</th>
                  <th style="width:130px">未分配</th>
                  <th>拥有者</th>
                  <th style="width:170px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in filteredItems"
                  :key="row.id"
                  :class="{ 'selected-row': selectedItemIds.includes(row.id) }"
                >
                  <td @click.stop>
                    <n-checkbox
                      :checked="selectedItemIds.includes(row.id)"
                      @update:checked="toggleSelectItem(row.id)"
                    />
                  </td>
                  <td>
                    <span
                      v-if="editingCell.id === row.id && editingCell.field === 'name'"
                      class="inline-edit"
                    >
                      <n-input
                        v-model:value="row.name"
                        size="small"
                        @blur="saveInlineEdit(row)"
                        @keydown.enter="saveInlineEdit(row)"
                      />
                    </span>
                    <span v-else class="editable-cell" @click="startInlineEdit(row, 'name')">
                      {{ row.name }}
                    </span>
                  </td>
                  <td>
                    <span class="type-badge">{{ row.type }}</span>
                    <span v-if="row.slot" class="slot-badge">{{ row.slot }}</span>
                  </td>
                  <td>
                    <span
                      v-if="editingCell.id === row.id && editingCell.field === 'quantity'"
                      class="inline-edit"
                    >
                      <n-input-number
                        v-model:value="row.quantity"
                        size="small" :min="0" :show-button="false"
                        @blur="saveInlineEdit(row)"
                        @keydown.enter="saveInlineEdit(row)"
                      />
                    </span>
                    <span v-else class="editable-cell" @click="startInlineEdit(row, 'quantity')">
                      {{ row.quantity }}
                    </span>
                  </td>
                  <td>
                    <span
                      v-if="editingCell.id === row.id && editingCell.field === 'unit_price'"
                      class="inline-edit"
                    >
                      <n-input-number
                        v-model:value="row.unit_price"
                        size="small" :min="0" :show-button="false"
                        @blur="saveInlineEdit(row)"
                        @keydown.enter="saveInlineEdit(row)"
                      />
                    </span>
                    <span v-else class="editable-cell" @click="startInlineEdit(row, 'unit_price')">
                      {{ row.unit_price }} gp
                    </span>
                  </td>
                  <td>
                    <span
                      v-if="editingCell.id === row.id && editingCell.field === 'weight'"
                      class="inline-edit"
                    >
                      <n-input-number
                        v-model:value="row.weight"
                        size="small" :min="0" :show-button="false"
                        @blur="saveInlineEdit(row)"
                        @keydown.enter="saveInlineEdit(row)"
                      />
                    </span>
                    <span v-else class="editable-cell" @click="startInlineEdit(row, 'weight')">
                      {{ formatAmount(row.weight) }} lb
                    </span>
                  </td>
                  <td>
                    <div v-if="getRemainingQuantity(row) > 0" class="remaining-cell">
                      <span class="remaining-qty">{{ formatAmount(getRemainingQuantity(row)) }}</span>
                      <span class="remaining-value">{{ getRemainingValue(row).toFixed(1) }} gp</span>
                    </div>
                  </td>
                  <td>
                    <div class="alloc-tags">
                      <span
                        v-for="alloc in row.allocations"
                        :key="alloc.character_id"
                        class="alloc-tag"
                        :style="{ borderColor: alloc.character_color, background: alloc.character_color + '18' }"
                      >
                        {{ alloc.character_name }} ×{{ alloc.quantity }}
                        <span class="tag-close" @click.stop="removeAllocation(row.id, alloc.character_id)">✕</span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <div class="action-btns">
                      <button class="icon-btn" title="详细编辑" @click.stop="openItemModal(row)">📝</button>
                      <button class="icon-btn" title="拆分" @click.stop="openSplitModal(row)">✂</button>
                      <button class="icon-btn" title="分配" @click.stop="openAllocate(row)">👤</button>
                      <button class="icon-btn danger" title="删除" @click.stop="removeItem(row)">🗑</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!filteredItems.length" class="empty-state">
              <span class="empty-icon">📦</span>
              <span>{{ items.length ? '无匹配结果' : '仓库空空如也，添加一些物品吧' }}</span>
            </div>
          </div>
        </div>
      </n-tab-pane>

      <!-- ===== TAB 2: 角色管理 ===== -->
      <n-tab-pane name="characters" tab="⚔ 角色管理">
        <div class="tab-content char-layout">
          <!-- Left: Character List -->
          <div class="char-list-panel">
            <div class="char-list-header">
              <h3 class="section-title">角色列表</h3>
              <n-button type="primary" size="small" @click="openNewCharacterModal">✦ 新建角色</n-button>
            </div>
            <div class="char-list">
              <div
                v-for="ch in characters"
                :key="ch.id"
                class="char-list-item"
                :class="{ active: selectedCharId === ch.id }"
                :style="{ '--char-color': ch.color }"
                @click="selectCharacter(ch)"
              >
                <div class="cli-avatar">
                  <img v-if="ch.portrait_path" :src="ch.portrait_path" alt="" />
                  <span v-else class="avatar-letter" :style="{ background: ch.color }">{{ ch.name.slice(0, 1) }}</span>
                </div>
                <div class="cli-info">
                  <span class="cli-name">{{ ch.name }}</span>
                  <span class="fantasy-badge" :class="ch.role === 'GM' ? 'arcane' : 'gold'" style="font-size:10px">{{ ch.role === 'GM' ? gmDisplayName : ch.role }}</span>
                </div>
              </div>
              <div v-if="!characters.length" class="empty-state small">暂无角色</div>
            </div>
          </div>

          <!-- Right: Character Detail -->
          <div class="char-detail-panel">
            <template v-if="selectedChar">
              <n-tabs v-model:value="charDetailTab" type="line" animated size="small">
                <!-- Edit Tab -->
                <n-tab-pane name="edit" tab="📝 编辑">
                  <div class="char-edit-content">
                    <div class="char-form-grid">
                      <div class="form-group">
                        <label class="form-label">角色名</label>
                        <n-input v-model:value="characterForm.name" placeholder="角色名称" />
                      </div>
                      <div class="form-group">
                        <label class="form-label">身份</label>
                        <n-select v-model:value="characterForm.role" :options="roleOptions" />
                      </div>
                      <div class="form-group">
                        <label class="form-label">色系</label>
                        <n-color-picker v-model:value="characterForm.color" size="small" />
                      </div>
                    </div>
                    <div class="form-actions">
                      <n-button type="primary" @click="saveCharacter">✦ 保存修改</n-button>
                      <label class="upload-label">
                        <input type="file" accept="image/*" @change="uploadPortrait($event, selectedChar)" />
                        📷 上传立绘
                      </label>
                      <n-button type="error" quaternary @click="removeCharacter(selectedChar)">🗑 删除角色</n-button>
                    </div>
                  </div>
                </n-tab-pane>

                <!-- Items Tab -->
                <n-tab-pane name="items" tab="🎒 装备与背包">
                  <CharacterInventoryPanel
                    :character="selectedChar"
                    :warehouse-items="items"
                    @changed="handleCharacterInventoryChanged"
                  />
                </n-tab-pane>

                <!-- Buff Tab -->
                <n-tab-pane name="buffs" tab="🛡 Buff管理">
                  <div class="buff-content">
                    <div class="buff-input-row">
                      <n-select
                        v-model:value="buffForm.level"
                        :options="buffLevelOptions"
                        placeholder="持续级别"
                        size="small"
                        style="width: 120px"
                      />
                      <n-input v-model:value="buffForm.name" placeholder="Buff名称" size="small" style="flex:1" />
                      <n-input v-model:value="buffForm.resource_note" placeholder="资源备注" size="small" style="width: 140px" />
                      <n-button type="primary" size="small" @click="addBuff">添加</n-button>
                    </div>
                    <div class="buff-list">
                      <div
                        v-for="buff in selectedChar.buffs"
                        :key="buff.id"
                        class="buff-item"
                      >
                        <span class="buff-level-tag">{{ buff.level }}</span>
                        <span class="buff-name">{{ buff.name }}</span>
                        <span class="muted">{{ buff.resource_note }}</span>
                        <button class="icon-btn danger small" @click="removeBuff(selectedChar.id, buff.id)">✕</button>
                      </div>
                      <div v-if="!selectedChar.buffs?.length" class="empty-state small">暂无Buff</div>
                    </div>
                  </div>
                </n-tab-pane>
              </n-tabs>
            </template>
            <div v-else class="empty-state">
              <span class="empty-icon">👈</span>
              <span>选择左侧角色查看详情</span>
            </div>
          </div>
        </div>
      </n-tab-pane>

      <!-- ===== TAB 3: 流水记录 ===== -->
      <n-tab-pane name="transactions" tab="💰 流水记录">
        <div class="tab-content">
          <div class="action-bar">
            <n-button type="primary" @click="txModalShow = true; resetTxForm()">✦ 新建记录</n-button>
            <div class="spacer"></div>
            <div class="tx-summary" v-if="txSummary">
              <span class="tx-s-income">收入: {{ formatAmount(txSummary.total_income) }} gp</span>
              <span class="tx-s-expense">支出: {{ formatAmount(txSummary.total_expense) }} gp</span>
              <span class="tx-s-consume">消耗: {{ formatAmount(txSummary.total_consume || 0) }} gp</span>
              <span class="tx-s-balance" :class="{ positive: txSummary.balance >= 0, negative: txSummary.balance < 0 }">
                余额: {{ formatAmount(txSummary.balance) }} gp
              </span>
            </div>
          </div>

          <div class="tx-list">
            <div
              v-for="entry in transactionFeed"
              :key="entry.key"
            >
              <div
                v-if="entry.kind === 'consume-group'"
                class="tx-card ornate-frame consume-group"
              >
                <div class="tx-header">
                  <span class="tx-type-badge consume">🧪 消耗</span>
                  <span class="tx-date">
                    {{ formatDate(entry.items[0]?.created_at) }}
                    <template v-if="entry.items.length > 1">
                      · 连续 {{ entry.items.length }} 条
                    </template>
                  </span>
                </div>
                <div class="tx-desc">
                  {{ entry.summaryText }}
                </div>
                <div class="tx-amounts">
                  <span>📦 物品价值: {{ formatAmount(entry.total) }} gp</span>
                </div>
                <div class="tx-actions">
                  <n-button size="small" quaternary @click="toggleConsumeGroup(entry.key)">
                    {{ expandedConsumeGroupKeys.includes(entry.key) ? '收起详情' : '展开详情' }}
                  </n-button>
                </div>
                <div v-if="expandedConsumeGroupKeys.includes(entry.key)" class="tx-group-detail">
                  <div
                    v-for="tx in entry.items"
                    :key="tx.id"
                    class="tx-subitem"
                  >
                    <div class="tx-subitem-main">
                      <div class="tx-subitem-desc">{{ tx.description }}</div>
                      <div class="tx-subitem-meta">
                        <span>{{ formatDate(tx.created_at) }}</span>
                        <span>总计 {{ formatAmount(tx.total_value) }} gp</span>
                        <span v-if="tx.note">{{ tx.note }}</span>
                      </div>
                    </div>
                    <button class="icon-btn danger small" @click="deleteTx(tx)">🗑</button>
                  </div>
                </div>
              </div>
              <div
                v-else
                class="tx-card ornate-frame"
                :class="entry.type"
              >
                <div class="tx-header">
                  <span class="tx-type-badge" :class="entry.type">
                    {{ txTypeLabel(entry.type) }}
                  </span>
                  <span class="tx-date">{{ formatDate(entry.created_at) }}</span>
                </div>
                <div class="tx-desc">{{ entry.description }}</div>
                <div class="tx-amounts">
                  <span v-if="entry.gp_amount">🪙 GP: {{ formatAmount(entry.gp_amount) }}</span>
                  <span v-if="entry.item_value">📦 物品: {{ formatAmount(entry.item_value) }} gp</span>
                  <span class="tx-total">总计: {{ formatAmount(entry.total_value) }} gp</span>
                </div>
                <div v-if="entry.note" class="tx-note muted">{{ entry.note }}</div>
                <div class="tx-actions">
                  <button class="icon-btn danger small" @click="deleteTx(entry)">🗑</button>
                </div>
              </div>
            </div>
            <div v-if="!transactions.length" class="empty-state">
              <span class="empty-icon">💰</span>
              <span>暂无流水记录</span>
            </div>
          </div>
        </div>
      </n-tab-pane>

      <!-- ===== TAB 4: Loot记录备忘录 ===== -->
      <n-tab-pane name="loot-records" tab="📋 Loot记录">
        <div class="tab-content">
          <div v-if="!lootRecords.length" class="empty-state">
            <span class="empty-icon">📋</span>
            <span>暂无Loot记录</span>
          </div>
          <div v-else class="loot-records-list">
            <div
              v-for="record in lootRecords"
              :key="record.id"
              class="loot-record-card ornate-frame"
            >
              <!-- Header -->
              <div class="lr-header">
                <span class="lr-date">{{ formatDate(record.created_at) }}</span>
                <div class="lr-header-right">
                  <span class="fantasy-badge gold">{{ lrItemCount(record) }} 项物品</span>
                  <span class="lr-total-value">总价值: {{ lrTotalValue(record).toFixed(1) }} gp</span>
                  <button class="icon-btn danger small" title="删除Loot记录" @click.stop="removeLootRecord(record)">🗑</button>
                </div>
              </div>

              <!-- Note -->
              <div v-if="record.note" class="lr-note-line muted">📝 {{ record.note }}</div>

              <!-- Items detail -->
              <div class="lr-items-section">
                <div
                  v-for="(item, idx) in (record.item_snapshot || [])"
                  :key="idx"
                  class="lr-item-row"
                >
                  <span class="type-badge small">{{ item.type || '其他' }}</span>
                  <span class="lr-item-name">{{ item.name || '未命名' }}</span>
                  <span class="lr-item-qty">×{{ item.quantity || 0 }}</span>
                  <span class="lr-item-price">{{ item.unit_price || 0 }} gp</span>
                  <span class="lr-item-subtotal">= {{ ((item.quantity || 0) * (item.unit_price || 0)).toFixed(1) }} gp</span>
                </div>
              </div>

              <!-- Allocations summary -->
              <div v-if="lrHasAllocations(record)" class="lr-alloc-section">
                <div class="lr-alloc-title">分配详情:</div>
                <div
                  v-for="(item, idx) in (record.item_snapshot || [])"
                  :key="'alloc-' + idx"
                >
                  <div
                    v-for="(alloc, aidx) in (item.allocations || [])"
                    :key="'a-' + idx + '-' + aidx"
                    class="lr-alloc-row"
                  >
                    <span class="lr-alloc-item-name">{{ item.name || '未命名' }}</span>
                    <span class="lr-alloc-arrow">→</span>
                    <span class="lr-alloc-char">{{ getCharacterName(alloc.characterId) }}</span>
                    <span class="lr-alloc-qty">×{{ alloc.quantity }}</span>
                  </div>
                </div>
              </div>

              <!-- Gold items -->
              <div v-if="(record.gold_snapshot || []).length" class="lr-gold-section">
                <span v-for="(g, gidx) in record.gold_snapshot" :key="'g-' + gidx" class="lr-gold-tag">
                  🪙 {{ g.label || 'GP' }}: {{ g.amount || 0 }}
                </span>
              </div>

              <!-- Value summary -->
              <div class="lr-value-summary">
                <span>已分配价值: {{ lrAllocatedValue(record).toFixed(1) }} gp</span>
                <span>总价值: {{ lrTotalValue(record).toFixed(1) }} gp</span>
              </div>

              <!-- Edit toggle -->
              <n-button size="small" quaternary @click="toggleRecordEdit(record.id)" style="margin-top:8px">
                {{ expandedRecordIds.includes(record.id) ? '收起编辑' : '📝 编辑备忘录' }}
              </n-button>

              <!-- Expandable edit section -->
              <div v-if="expandedRecordIds.includes(record.id)" class="lr-edit-section">
                <n-input
                  type="textarea"
                  :value="record.memo_text"
                  @update:value="(v) => (record.memo_text = v)"
                  placeholder="可编辑备忘录"
                  :autosize="{ minRows: 2, maxRows: 5 }"
                />
                <n-button size="small" type="primary" @click="saveRecordMemo(record)" style="margin-top:8px">
                  保存备忘录
                </n-button>
              </div>
            </div>
          </div>
        </div>
      </n-tab-pane>
    </n-tabs>

    <!-- ===== Modals ===== -->

    <!-- Item Edit Modal -->
    <ItemEditModal
      v-model:show="itemModalShow"
      :item="itemModalData"
      @save="onItemModalSave"
      @split="onItemModalSplit"
    />

    <!-- Allocation Modal -->
    <n-modal v-model:show="allocationModal" preset="card" title="分配物品" style="max-width: 480px">
      <div class="alloc-form">
        <div class="form-group">
          <label class="form-label">物品</label>
          <div class="alloc-item-name">{{ allocationState.item?.name }}</div>
        </div>
        <div class="form-group">
          <label class="form-label">分配给角色</label>
          <n-select
            v-model:value="allocationState.characterId"
            :options="characterOptions"
            placeholder="选择角色"
          />
        </div>
        <div class="form-group">
          <label class="form-label">数量</label>
          <n-input-number v-model:value="allocationState.quantity" :min="1" />
        </div>
        <div class="form-group">
          <label class="form-label">模式</label>
          <n-radio-group v-model:value="allocationState.mode">
            <n-space>
              <n-radio value="set">覆盖设定</n-radio>
              <n-radio value="merge">叠加分配</n-radio>
              <n-radio value="takeover">抢占分配</n-radio>
            </n-space>
          </n-radio-group>
        </div>
        <div class="form-actions">
          <n-button @click="allocationModal = false">取消</n-button>
          <n-button type="primary" @click="submitAllocation">提交分配</n-button>
        </div>
      </div>
    </n-modal>

    <!-- New Character Modal -->
    <n-modal v-model:show="newCharModalShow" preset="card" title="✦ 新建角色" style="max-width: 480px">
      <div class="new-char-form">
        <div class="char-form-grid">
          <div class="form-group">
            <label class="form-label">角色名</label>
            <n-input v-model:value="newCharForm.name" placeholder="角色名称" />
          </div>
          <div class="form-group">
            <label class="form-label">身份</label>
            <n-select v-model:value="newCharForm.role" :options="roleOptions" />
          </div>
          <div class="form-group">
            <label class="form-label">色系</label>
            <n-color-picker v-model:value="newCharForm.color" size="small" />
          </div>
        </div>
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="newCharModalShow = false">取消</n-button>
          <n-button type="primary" @click="createCharacter">✦ 创建角色</n-button>
        </div>
      </template>
    </n-modal>

    <!-- Transaction Modal -->
    <n-modal v-model:show="txModalShow" preset="card" title="✦ 新建流水记录" style="max-width: 520px">
      <div class="tx-form">
        <div class="form-group">
          <label class="form-label">类型</label>
          <n-radio-group v-model:value="txForm.type">
            <n-space>
              <n-radio value="income">📈 收入</n-radio>
              <n-radio value="expense">📉 支出</n-radio>
              <n-radio value="consume">🧪 消耗</n-radio>
            </n-space>
          </n-radio-group>
        </div>
        <div class="form-group">
          <label class="form-label">描述</label>
          <n-input v-model:value="txForm.description" placeholder="例如: 击败红龙获得宝藏" />
        </div>
        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">GP 金额</label>
            <n-input-number v-model:value="txForm.gp_amount" :min="0" />
          </div>
          <div class="form-group flex-1">
            <label class="form-label">物品价值 (gp)</label>
            <n-input-number v-model:value="txForm.item_value" :min="0" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">备注</label>
          <n-input v-model:value="txForm.note" placeholder="可选备注" />
        </div>
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="txModalShow = false">取消</n-button>
          <n-button type="primary" @click="createTransaction">✦ 创建记录</n-button>
        </div>
      </template>
    </n-modal>

    <!-- AI Input Modal -->
    <AiInputModal
      v-model:show="aiModalShow"
      :parse-endpoint="aiParseEndpoint"
      @confirm="onAiConfirm"
    />

    <!-- Batch Type Modal -->
    <n-modal v-model:show="batchTypeModalShow" preset="card" title="🏷 批量修改物品类型" style="max-width: 460px">
      <div class="batch-type-form">
        <div class="muted">已选择 {{ selectedItemIds.length }} 个物品</div>
        <div class="form-group" style="margin-top: 10px;">
          <label class="form-label">目标类型</label>
          <n-select
            v-model:value="batchTypeTarget"
            :options="itemTypeOptions"
            placeholder="选择要修改的类型"
          />
        </div>
        <div v-if="batchTypeTarget && batchTypeTarget !== '装备'" class="muted" style="margin-top: 8px; font-size: 12px;">
          修改为非装备类型时，会自动清空槽位。
        </div>
        <div v-if="batchTypeTarget === '装备'" class="form-group" style="margin-top: 10px;">
          <label class="form-label">目标槽位</label>
          <n-select
            v-model:value="batchTypeSlot"
            :options="batchSlotOptions"
            clearable
            placeholder="选择槽位（不选则尽量保留原槽位）"
          />
        </div>
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="batchTypeModalShow = false">取消</n-button>
          <n-button type="primary" @click="confirmBatchTypeUpdate">确认修改</n-button>
        </div>
      </template>
    </n-modal>

    <!-- Split Item Modal -->
    <n-modal v-model:show="splitModalShow" preset="card" title="✂ 拆分物品" style="max-width: 420px">
      <div class="split-form">
        <div class="muted">物品：{{ splitState.item?.name || '-' }}</div>
        <div class="muted">当前数量：{{ formatAmount(splitState.item?.quantity || 0) }}</div>
        <div class="form-group" style="margin-top: 10px;">
          <label class="form-label">拆分数量</label>
          <n-input-number
            v-model:value="splitState.quantity"
            :min="0.01"
            :max="splitMaxQuantity"
            :precision="2"
            style="width: 100%;"
          />
        </div>
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="splitModalShow = false">取消</n-button>
          <n-button type="primary" @click="confirmSplit">确认拆分</n-button>
        </div>
      </template>
    </n-modal>

    <!-- Merge Items Modal -->
    <n-modal v-model:show="mergeModalShow" preset="card" title="🧬 合并物品" style="max-width: 520px">
      <div class="merge-form">
        <div class="muted">将合并 {{ mergeState.items.length }} 个物品</div>
        <div v-if="mergeState.conflict" class="muted" style="margin-top: 8px; color: var(--danger);">
          检测到选中物品数据不一致，请选择模板物品（名称/类型/槽位/价格/重量/描述将以模板为准）。
        </div>
        <div class="merge-items-list">
          <label
            v-for="it in mergeState.items"
            :key="it.id"
            class="merge-item-option"
          >
            <n-radio
              :checked="mergeState.templateItemId === it.id"
              :disabled="!mergeState.conflict"
              @update:checked="(checked) => { if (checked) mergeState.templateItemId = it.id; }"
            />
            <div class="merge-item-meta">
              <div class="merge-item-title">
                <span class="type-badge small">{{ it.type }}</span>
                <span>{{ it.name }}</span>
                <span class="muted">×{{ formatAmount(it.quantity) }}</span>
              </div>
              <div class="muted" style="font-size: 12px;">
                槽位: {{ it.slot || '-' }} · 单价: {{ it.unit_price }} gp · 重量: {{ it.weight }} lb
              </div>
            </div>
          </label>
        </div>
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="mergeModalShow = false">取消</n-button>
          <n-button type="primary" @click="confirmMerge">确认合并</n-button>
        </div>
      </template>
    </n-modal>

    <!-- Delete Confirmation Modal -->
    <n-modal v-model:show="deleteModalShow" preset="card" title="⚠ 删除确认" style="max-width: 480px">
      <div class="delete-confirm-form">
        <div class="delete-confirm-msg">
          {{ deleteModalMessage }}
        </div>
        <div class="form-group" style="margin-top: 12px;">
          <n-checkbox v-model:checked="deleteAddTransaction">
            同时添加流水记录（支出）
          </n-checkbox>
        </div>
        <div v-if="deleteAddTransaction" class="form-group" style="margin-top: 8px;">
          <label class="form-label">备注</label>
          <n-input v-model:value="deleteNote" placeholder="删除原因或备注（可选）" />
        </div>
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="deleteModalShow = false">取消</n-button>
          <n-button type="error" @click="confirmDelete">🗑 确认删除</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import {
  NTabs,
  NTabPane,
  NInput,
  NSelect,
  NColorPicker,
  NButton,
  NInputNumber,
  NCheckbox,
  NModal,
  NRadioGroup,
  NRadio,
  NSpace,
  useMessage
} from 'naive-ui';
import { apiRequest } from '../utils/api';
import ItemEditModal from '../components/ItemEditModal.vue';
import AiInputModal from '../components/AiInputModal.vue';
import CharacterInventoryPanel from '../components/CharacterInventoryPanel.vue';

const message = useMessage();
const activeTab = ref('warehouse');

const characters = ref([]);
const items = ref([]);
const lootRecords = ref([]);
const transactions = ref([]);
const txSummary = ref(null);

// --- Warehouse filtering/sorting ---
const warehouseFilter = reactive({
  keyword: '',
  type: '',
  assignment: '',
  matchMode: 'all',
  sort: 'name_asc'
});
const selectedItemIds = ref([]);

const itemTypeOptions = [
  { label: '装备', value: '装备' },
  { label: '金钱', value: '金钱' },
  { label: '药水', value: '药水' },
  { label: '卷轴', value: '卷轴' },
  { label: '其他', value: '其他' }
];

const batchSlotOptions = [
  '主手', '副手', '盔甲', '盾牌', '披风', '腰带',
  '头环', '头部', '护符', '戒指', '腕部', '胸部',
  '躯体', '眼睛', '脚部', '手套', '手臂', '奇物'
].map((x) => ({ label: x, value: x }));

const typeFilterOptions = computed(() => [
  { label: '全部类型', value: '' },
  ...itemTypeOptions
]);

const assignmentFilterOptions = computed(() => {
  const baseOptions = [
    { label: '分配：全部', value: '' },
    { label: '分配：未分配', value: 'unassigned' },
    { label: '分配：已分配', value: 'assigned_full' },
    { label: '分配：部分分配', value: 'assigned_partial' },
    { label: '分配：未分配+部分分配', value: 'unassigned_or_partial' }
  ];
  const plOptions = characters.value
    .filter((x) => x.role === 'PL')
    .map((x) => ({ label: `分配：${x.name}`, value: `char:${x.id}` }));
  return [...baseOptions, ...plOptions];
});

const matchModeOptions = [
  { label: '筛选: 同时满足', value: 'all' },
  { label: '筛选: 任意满足', value: 'any' }
];

const sortOptions = [
  { label: '名称 A→Z', value: 'name_asc' },
  { label: '名称 Z→A', value: 'name_desc' },
  { label: '价格 高→低', value: 'price_desc' },
  { label: '价格 低→高', value: 'price_asc' },
  { label: '数量 多→少', value: 'qty_desc' },
  { label: '未分配数量 多→少', value: 'remaining_qty_desc' },
  { label: '未分配数量 少→多', value: 'remaining_qty_asc' },
  { label: '未分配价值 高→低', value: 'remaining_value_desc' },
  { label: '未分配价值 低→高', value: 'remaining_value_asc' },
  { label: '最新添加', value: 'newest' }
];

function getRemainingQuantity(item) {
  const raw = Number(item?.remaining_quantity);
  if (Number.isFinite(raw)) {
    return Math.max(0, raw);
  }
  const quantity = Number(item?.quantity || 0);
  const allocated = getAllocatedQuantity(item);
  return Math.max(0, quantity - allocated);
}

function getAllocatedQuantity(item) {
  const raw = Number(item?.allocated_quantity);
  if (Number.isFinite(raw)) {
    return Math.max(0, raw);
  }
  return (item?.allocations || []).reduce((sum, x) => sum + Number(x.quantity || 0), 0);
}

function getRemainingValue(item) {
  return getRemainingQuantity(item) * Number(item?.unit_price || 0);
}

function formatAmount(value) {
  const raw = Number(value || 0);
  const num = Math.abs(raw) < 1e-9 ? 0 : raw;
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseConsumeDescription(description) {
  const text = String(description || '').trim();
  const match = text.match(/ 消耗 (.+?) ×([0-9][0-9,\.]*)$/);
  if (!match) return null;
  return {
    itemName: String(match[1] || '').trim(),
    quantity: Number(String(match[2] || '').replace(/,/g, ''))
  };
}

function buildConsumeGroupSummary(items) {
  const grouped = new Map();
  const fallback = [];

  for (const tx of items || []) {
    const parsed = parseConsumeDescription(tx?.description);
    if (!parsed || !parsed.itemName || !Number.isFinite(parsed.quantity)) {
      fallback.push(String(tx?.description || '').trim());
      continue;
    }
    grouped.set(parsed.itemName, (grouped.get(parsed.itemName) || 0) + parsed.quantity);
  }

  if (!grouped.size) {
    const text = fallback.filter(Boolean).join('，');
    return text ? `消耗：${text}` : '消耗';
  }

  const parts = [...grouped.entries()].map(([itemName, quantity]) => `${itemName} x${formatAmount(quantity)}`);
  return `消耗：${parts.join('，')}`;
}

function normalizeMergeSlot(slot) {
  const text = String(slot || '').trim();
  if (!text) return '';
  if (text.startsWith('戒指')) return '戒指';
  return text;
}

function mergeComparableSignature(item) {
  return JSON.stringify([
    String(item?.name || '').trim(),
    String(item?.type || '').trim(),
    normalizeMergeSlot(item?.slot),
    Number(item?.unit_price || 0),
    Number(item?.weight || 0),
    String(item?.description || '').trim(),
    String(item?.display_description || '').trim()
  ]);
}

const filteredItems = computed(() => {
  let list = [...items.value];
  const conditions = [];

  if (warehouseFilter.keyword) {
    const kw = warehouseFilter.keyword.toLowerCase();
    conditions.push((x) => (x.name || '').toLowerCase().includes(kw));
  }
  if (warehouseFilter.type) {
    conditions.push((x) => x.type === warehouseFilter.type);
  }
  if (warehouseFilter.assignment) {
    const assignment = warehouseFilter.assignment;
    if (assignment === 'unassigned') {
      conditions.push((x) => getAllocatedQuantity(x) <= 0);
    } else if (assignment === 'assigned_full') {
      conditions.push((x) => getAllocatedQuantity(x) > 0 && getRemainingQuantity(x) <= 0);
    } else if (assignment === 'assigned_partial') {
      conditions.push((x) => getAllocatedQuantity(x) > 0 && getRemainingQuantity(x) > 0);
    } else if (assignment === 'unassigned_or_partial') {
      conditions.push((x) => getRemainingQuantity(x) > 0);
    } else if (assignment.startsWith('char:')) {
      const characterId = assignment.slice(5);
      conditions.push((x) => (x.allocations || []).some(
        (alloc) => alloc.character_id === characterId && Number(alloc.quantity || 0) > 0
      ));
    }
  }

  if (conditions.length) {
    const useAny = warehouseFilter.matchMode === 'any';
    list = list.filter((x) => (useAny
      ? conditions.some((fn) => fn(x))
      : conditions.every((fn) => fn(x))));
  }

  const sort = warehouseFilter.sort;
  if (sort === 'name_asc') list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  else if (sort === 'name_desc') list.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
  else if (sort === 'price_desc') list.sort((a, b) => b.unit_price - a.unit_price);
  else if (sort === 'price_asc') list.sort((a, b) => a.unit_price - b.unit_price);
  else if (sort === 'qty_desc') list.sort((a, b) => b.quantity - a.quantity);
  else if (sort === 'remaining_qty_desc') list.sort((a, b) => getRemainingQuantity(b) - getRemainingQuantity(a));
  else if (sort === 'remaining_qty_asc') list.sort((a, b) => getRemainingQuantity(a) - getRemainingQuantity(b));
  else if (sort === 'remaining_value_desc') list.sort((a, b) => getRemainingValue(b) - getRemainingValue(a));
  else if (sort === 'remaining_value_asc') list.sort((a, b) => getRemainingValue(a) - getRemainingValue(b));
  else if (sort === 'newest') list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return list;
});

const allItemsSelected = computed(() =>
  filteredItems.value.length > 0 && filteredItems.value.every((x) => selectedItemIds.value.includes(x.id))
);
const someItemsSelected = computed(() =>
  !allItemsSelected.value && filteredItems.value.some((x) => selectedItemIds.value.includes(x.id))
);

function toggleSelectAll(checked) {
  if (checked) {
    selectedItemIds.value = filteredItems.value.map((x) => x.id);
  } else {
    selectedItemIds.value = [];
  }
}

function toggleSelectItem(id) {
  const idx = selectedItemIds.value.indexOf(id);
  if (idx >= 0) selectedItemIds.value.splice(idx, 1);
  else selectedItemIds.value.push(id);
}

async function batchDeleteItems() {
  deleteModalItems.value = filteredItems.value.filter(x => selectedItemIds.value.includes(x.id));
  if (!deleteModalItems.value.length) return;
  deleteModalMessage.value = `确认删除 ${deleteModalItems.value.length} 个物品？`;
  deleteModalMode.value = 'batch';
  deleteAddTransaction.value = true;
  deleteNote.value = '';
  deleteModalShow.value = true;
}

// --- Batch type update ---
const batchTypeModalShow = ref(false);
const batchTypeTarget = ref('');
const batchTypeSlot = ref(null);

function openBatchTypeModal() {
  if (!selectedItemIds.value.length) return;
  const selectedRows = items.value.filter((x) => selectedItemIds.value.includes(x.id));
  const typeSet = new Set(selectedRows.map((x) => x.type).filter(Boolean));
  batchTypeTarget.value = typeSet.size === 1 ? [...typeSet][0] : '';
  const slotSet = new Set(
    selectedRows
      .filter((x) => x.type === '装备')
      .map((x) => {
        const text = String(x.slot || '').trim();
        if (!text) return null;
        if (text.startsWith('戒指')) return '戒指';
        return text;
      })
      .filter((x) => x != null && String(x).trim() !== '')
  );
  batchTypeSlot.value = slotSet.size === 1 ? [...slotSet][0] : null;
  batchTypeModalShow.value = true;
}

async function confirmBatchTypeUpdate() {
  if (!batchTypeTarget.value) {
    message.warning('请选择目标类型');
    return;
  }
  const selectedRows = items.value.filter((x) => selectedItemIds.value.includes(x.id));
  if (!selectedRows.length) {
    batchTypeModalShow.value = false;
    return;
  }

  try {
    await Promise.all(selectedRows.map((row) => apiRequest(`/api/items/${row.id}`, {
      method: 'PUT',
      body: {
        ...row,
        type: batchTypeTarget.value,
        slot: batchTypeTarget.value === '装备'
          ? (batchTypeSlot.value ?? row.slot ?? null)
          : null
      }
    })));
    message.success(`已批量修改 ${selectedRows.length} 个物品类型`);
    batchTypeModalShow.value = false;
    selectedItemIds.value = [];
    await Promise.all([loadItems(), loadCharacters()]);
  } catch (error) {
    message.error(error.message || '批量修改类型失败');
  }
}

// --- Split item ---
const splitModalShow = ref(false);
const splitState = reactive({ item: null, quantity: 1 });

const splitMaxQuantity = computed(() => {
  const row = splitState.item;
  if (!row) return 0;
  const max = getRemainingQuantity(row);
  return Number.isFinite(max) ? Math.max(0, max) : 0;
});

function openSplitModal(row) {
  const quantity = Number(row?.quantity || 0);
  if (quantity <= 1) {
    message.warning('当前数量不足以拆分');
    return;
  }
  const remaining = getRemainingQuantity(row);
  if (remaining <= 0) {
    message.warning('该物品无未分配数量，无法拆分');
    return;
  }
  splitState.item = row;
  splitState.quantity = Math.min(Math.max(1, Math.floor(quantity / 2)), remaining);
  splitModalShow.value = true;
}

async function confirmSplit() {
  if (!splitState.item) return;
  const qty = Number(splitState.quantity || 0);
  if (!Number.isFinite(qty) || qty <= 0) {
    message.warning('请输入有效拆分数量');
    return;
  }
  try {
    await apiRequest(`/api/items/${splitState.item.id}/split`, {
      method: 'POST',
      body: { quantity: qty }
    });
    message.success('物品已拆分');
    splitModalShow.value = false;
    splitState.item = null;
    splitState.quantity = 1;
    await Promise.all([loadItems(), loadCharacters()]);
  } catch (error) {
    message.error(error.message || '拆分失败');
  }
}

// --- Merge items ---
const mergeModalShow = ref(false);
const mergeState = reactive({
  items: [],
  conflict: false,
  templateItemId: ''
});

function openMergeModal() {
  const selectedRows = items.value.filter((x) => selectedItemIds.value.includes(x.id));
  if (selectedRows.length < 2) {
    message.warning('请至少选择两个物品');
    return;
  }
  const signatures = selectedRows.map((x) => mergeComparableSignature(x));
  const conflict = signatures.some((x) => x !== signatures[0]);
  mergeState.items = selectedRows.map((x) => ({ ...x }));
  mergeState.conflict = conflict;
  mergeState.templateItemId = selectedRows[0].id;
  mergeModalShow.value = true;
}

async function confirmMerge() {
  if (mergeState.items.length < 2) {
    mergeModalShow.value = false;
    return;
  }
  if (mergeState.conflict && !mergeState.templateItemId) {
    message.warning('请选择模板物品');
    return;
  }
  try {
    await apiRequest('/api/items/merge', {
      method: 'POST',
      body: {
        itemIds: mergeState.items.map((x) => x.id),
        templateItemId: mergeState.conflict ? mergeState.templateItemId : null
      }
    });
    message.success('物品已合并');
    mergeModalShow.value = false;
    mergeState.items = [];
    mergeState.conflict = false;
    mergeState.templateItemId = '';
    selectedItemIds.value = [];
    await Promise.all([loadItems(), loadCharacters()]);
  } catch (error) {
    if (error.status === 409 && error.payload?.requires_template) {
      mergeState.conflict = true;
      const list = Array.isArray(error.payload.items) ? error.payload.items : [];
      if (list.length) {
        mergeState.items = list;
        if (!mergeState.templateItemId || !list.some((x) => x.id === mergeState.templateItemId)) {
          mergeState.templateItemId = list[0].id;
        }
      }
      mergeModalShow.value = true;
      message.warning(error.payload.message || '请选择模板物品后再合并');
      return;
    }
    message.error(error.message || '合并失败');
  }
}

// --- Inline Edit ---
const editingCell = reactive({ id: '', field: '' });

function startInlineEdit(row, field) {
  editingCell.id = row.id;
  editingCell.field = field;
}

async function saveInlineEdit(row) {
  editingCell.id = '';
  editingCell.field = '';
  try {
    await apiRequest(`/api/items/${row.id}`, { method: 'PUT', body: { ...row } });
    await Promise.all([loadItems(), loadCharacters()]);
  } catch (error) {
    message.error(error.message || '保存失败');
    await loadItems();
  }
}

// --- Item Modal ---
const itemModalShow = ref(false);
const itemModalData = ref(null);

function openItemModal(row) {
  itemModalData.value = row ? { ...row } : {
    name: '', type: '其他', slot: null, quantity: 1,
    unit_price: 0, weight: 0, description: '', display_description: ''
  };
  itemModalShow.value = true;
}

async function onItemModalSave(data) {
  try {
    if (data.id) {
      await apiRequest(`/api/items/${data.id}`, { method: 'PUT', body: data });
      message.success('物品已更新');
    } else {
      await apiRequest('/api/items', { method: 'POST', body: data });
      message.success('物品已创建');
    }
    itemModalShow.value = false;
    await Promise.all([loadItems(), loadCharacters()]);
  } catch (error) {
    message.error(error.message || '保存物品失败');
  }
}

function onItemModalSplit(data) {
  itemModalShow.value = false;
  const row = items.value.find((x) => x.id === data?.id) || data;
  openSplitModal(row);
}

// --- Allocation ---
const allocationModal = ref(false);
const allocationState = reactive({ item: null, characterId: '', quantity: 1, mode: 'set' });

const characterOptions = computed(() =>
  characters.value.map((x) => ({ label: `${x.name}(${x.role})`, value: x.id }))
);

function openAllocate(row) {
  allocationState.item = row;
  allocationState.characterId = '';
  allocationState.quantity = 1;
  allocationState.mode = 'set';
  allocationModal.value = true;
}

async function submitAllocation() {
  if (!allocationState.item || !allocationState.characterId) {
    message.warning('请选择角色');
    return;
  }
  try {
    const data = await apiRequest(`/api/items/${allocationState.item.id}/allocations`, {
      method: 'POST',
      body: {
        characterId: allocationState.characterId,
        quantity: allocationState.quantity,
        mode: allocationState.mode
      }
    });
    if (data?.item) message.success('分配成功');
    allocationModal.value = false;
    await Promise.all([loadItems(), loadCharacters()]);
  } catch (error) {
    if (error.status === 409 && error.payload?.requires_confirm) {
      const confirmed = window.confirm(`${error.payload.message}，是否改为抢占分配？`);
      if (confirmed) {
        allocationState.mode = 'takeover';
        await submitAllocation();
      }
      return;
    }
    message.error(error.message || '分配失败');
  }
}

async function removeAllocation(itemId, characterId) {
  try {
    await apiRequest(`/api/items/${itemId}/allocations/${characterId}`, { method: 'DELETE' });
    await Promise.all([loadItems(), loadCharacters()]);
  } catch (error) {
    message.error(error.message || '移除分配失败');
  }
}

// --- Character Management ---
const selectedCharId = ref('');
const charDetailTab = ref('edit');
const newCharModalShow = ref(false);
const gmDisplayName = ref('GM');
const roleOptions = computed(() => [
  { label: gmDisplayName.value, value: 'GM' },
  { label: 'PL', value: 'PL' },
  { label: '其他', value: '其他' }
]);

const selectedChar = computed(() =>
  characters.value.find((x) => x.id === selectedCharId.value) || null
);

const characterForm = reactive({
  id: '', name: '', role: 'PL', color: '#5B8FF9', notes: ''
});

function randomFantasyColor() {
  const hue = Math.floor(Math.random() * 360);
  const sat = 50 + Math.floor(Math.random() * 30);
  const lum = 45 + Math.floor(Math.random() * 20);
  return `hsl(${hue}, ${sat}%, ${lum}%)`;
}

const newCharForm = reactive({
  name: '', role: 'PL', color: randomFantasyColor()
});

function openNewCharacterModal() {
  newCharForm.name = '';
  newCharForm.role = 'PL';
  newCharForm.color = randomFantasyColor();
  newCharModalShow.value = true;
}

function syncCharacterForm(ch) {
  if (!ch) return;
  selectedCharId.value = ch.id;
  characterForm.id = ch.id;
  characterForm.name = ch.name;
  characterForm.role = ch.role;
  characterForm.color = ch.color;
  characterForm.notes = ch.notes || '';
}

function selectCharacter(ch, options = {}) {
  syncCharacterForm(ch);
  if (options.keepTab) return;
  charDetailTab.value = 'edit';
}

async function createCharacter() {
  if (!newCharForm.name) {
    message.warning('请输入角色名');
    return;
  }
  try {
    await apiRequest('/api/characters', { method: 'POST', body: { ...newCharForm } });
    message.success('角色已创建');
    newCharModalShow.value = false;
    await loadCharacters();
  } catch (error) {
    message.error(error.message || '创建角色失败');
  }
}

async function saveCharacter() {
  if (!characterForm.name) {
    message.warning('请输入角色名');
    return;
  }
  try {
    await apiRequest(`/api/characters/${characterForm.id}`, {
      method: 'PUT', body: { ...characterForm }
    });
    message.success('角色已更新');
    await loadCharacters();
  } catch (error) {
    message.error(error.message || '保存角色失败');
  }
}

async function removeCharacter(row) {
  const confirmName = window.prompt(`删除角色 ${row.name} 前，请输入完整角色名确认`);
  if (confirmName == null) return;
  try {
    await apiRequest(`/api/characters/${row.id}`, {
      method: 'DELETE', body: { confirmName }
    });
    message.success('角色已删除');
    if (selectedCharId.value === row.id) selectedCharId.value = '';
    await Promise.all([loadCharacters(), loadItems()]);
  } catch (error) {
    message.error(error.message || '删除角色失败');
  }
}

async function uploadPortrait(event, row) {
  const file = event.target.files?.[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('portrait', file);
  try {
    await apiRequest(`/api/characters/${row.id}/portrait`, { method: 'POST', body: formData });
    message.success('立绘上传成功');
    await loadCharacters();
  } catch (error) {
    message.error(error.message || '上传立绘失败');
  } finally {
    event.target.value = '';
  }
}

// --- Buff Management ---
const buffLevelOptions = ['天级', '小时级', '十分钟级', '分钟级', '轮级'].map((x) => ({
  label: x, value: x
}));

const buffForm = reactive({ level: '天级', name: '', resource_note: '' });

async function addBuff() {
  if (!selectedCharId.value || !buffForm.name) {
    message.warning('请完整填写Buff信息');
    return;
  }
  try {
    await apiRequest(`/api/characters/${selectedCharId.value}/buffs`, {
      method: 'POST', body: { level: buffForm.level, name: buffForm.name, resource_note: buffForm.resource_note }
    });
    buffForm.name = '';
    buffForm.resource_note = '';
    await loadCharacters();
  } catch (error) {
    message.error(error.message || '添加Buff失败');
  }
}

async function removeBuff(characterId, buffId) {
  try {
    await apiRequest(`/api/characters/${characterId}/buffs/${buffId}`, { method: 'DELETE' });
    await loadCharacters();
  } catch (error) {
    message.error(error.message || '删除Buff失败');
  }
}

async function handleCharacterInventoryChanged(payload = {}) {
  const tasks = [];
  if (payload.reloadCharacters !== false) tasks.push(loadCharacters());
  if (payload.reloadItems !== false) tasks.push(loadItems());
  if (payload.reloadTransactions) tasks.push(loadTransactions());
  await Promise.all(tasks);
}

// --- Transaction Management ---
const txModalShow = ref(false);
const txForm = reactive({ type: 'income', description: '', gp_amount: 0, item_value: 0, note: '' });
const expandedConsumeGroupKeys = ref([]);

function resetTxForm() {
  txForm.type = 'income';
  txForm.description = '';
  txForm.gp_amount = 0;
  txForm.item_value = 0;
  txForm.note = '';
}

async function createTransaction() {
  if (!txForm.description) {
    message.warning('请输入描述');
    return;
  }
  try {
    await apiRequest('/api/transactions', { method: 'POST', body: { ...txForm } });
    message.success('流水记录已创建');
    txModalShow.value = false;
    await loadTransactions();
  } catch (error) {
    message.error(error.message || '创建记录失败');
  }
}

async function deleteTx(tx) {
  if (!window.confirm(`确认删除记录：${tx.description}？`)) return;
  try {
    await apiRequest(`/api/transactions/${tx.id}`, { method: 'DELETE' });
    message.success('记录已删除');
    await loadTransactions();
  } catch (error) {
    message.error(error.message || '删除失败');
  }
}

const transactionFeed = computed(() => {
  const list = transactions.value || [];
  const result = [];

  for (let index = 0; index < list.length; index += 1) {
    const current = list[index];
    if (current.type !== 'consume') {
      result.push({
        ...current,
        kind: 'tx',
        key: current.id
      });
      continue;
    }

    const group = [current];
    while (index + 1 < list.length && list[index + 1].type === 'consume') {
      group.push(list[index + 1]);
      index += 1;
    }

    if (group.length === 1) {
      result.push({
        ...current,
        kind: 'tx',
        key: current.id
      });
      continue;
    }

    result.push({
      kind: 'consume-group',
      key: `consume-group-${group[0].id}`,
      items: group,
      total: group.reduce((sum, row) => sum + Number(row.total_value || 0), 0),
      summaryText: buildConsumeGroupSummary(group)
    });
  }

  return result;
});

function toggleConsumeGroup(key) {
  const index = expandedConsumeGroupKeys.value.indexOf(key);
  if (index >= 0) expandedConsumeGroupKeys.value.splice(index, 1);
  else expandedConsumeGroupKeys.value.push(key);
}

function txTypeLabel(type) {
  if (type === 'income') return '📈 收入';
  if (type === 'expense') return '📉 支出';
  if (type === 'consume') return '🧪 消耗';
  return type;
}

// --- AI Modal ---
const aiModalShow = ref(false);
const aiParseEndpoint = ref('/api/ai/parse-loot');

// --- Loot Record Helpers ---
const expandedRecordIds = ref([]);

function toggleRecordEdit(recordId) {
  const idx = expandedRecordIds.value.indexOf(recordId);
  if (idx >= 0) {
    expandedRecordIds.value.splice(idx, 1);
  } else {
    expandedRecordIds.value.push(recordId);
  }
}

function lrItemCount(record) {
  return (record.item_snapshot || []).reduce((sum, x) => sum + Number(x.quantity || 0), 0);
}

function lrTotalValue(record) {
  return (record.item_snapshot || []).reduce(
    (sum, x) => sum + Number(x.quantity || 0) * Number(x.unit_price || 0), 0
  );
}

function lrAllocatedValue(record) {
  let total = 0;
  for (const item of record.item_snapshot || []) {
    for (const alloc of item.allocations || []) {
      total += Number(alloc.quantity || 0) * Number(item.unit_price || 0);
    }
  }
  return total;
}

function lrHasAllocations(record) {
  return (record.item_snapshot || []).some(item => (item.allocations || []).length > 0);
}

function getCharacterName(characterId) {
  if (!characterId) return '未分配';
  const ch = characters.value.find(x => x.id === characterId);
  return ch ? ch.name : '未知角色';
}

async function onAiConfirm(result) {
  const lootItems = result.items || [];
  try {
    for (const x of lootItems) {
      await apiRequest('/api/items', {
        method: 'POST',
        body: {
          name: x.name || '未命名',
          type: x.type || '其他',
          slot: x.slot || null,
          quantity: Number(x.quantity || 1),
          unit_price: Number(x.unit_price || 0),
          weight: Number(x.weight || 0),
          description: x.description || '',
          display_description: x.display_description || ''
        }
      });
    }
    if (lootItems.length) {
      message.success(`AI 已录入 ${lootItems.length} 个物品`);
      await Promise.all([loadItems(), loadCharacters()]);
    }
  } catch (error) {
    message.error(error.message || '录入失败');
  }
}

// --- Remove Item (with modal) ---
const deleteModalShow = ref(false);
const deleteModalMessage = ref('');
const deleteModalMode = ref('single'); // 'single' or 'batch'
const deleteModalItems = ref([]);
const deleteAddTransaction = ref(true);
const deleteNote = ref('');

async function removeItem(row) {
  deleteModalItems.value = [row];
  deleteModalMessage.value = `确认删除物品：${row.name} ?`;
  deleteModalMode.value = 'single';
  deleteAddTransaction.value = true;
  deleteNote.value = '';
  deleteModalShow.value = true;
}

async function confirmDelete() {
  const itemsToDelete = deleteModalItems.value;
  if (!itemsToDelete.length) return;

  try {
    // If checkbox is checked, create a transaction record first
    if (deleteAddTransaction.value) {
      const totalValue = itemsToDelete.reduce(
        (sum, x) => sum + Number(x.quantity || 0) * Number(x.unit_price || 0), 0
      );
      const names = itemsToDelete.map(x => x.name).join(', ');
      await apiRequest('/api/transactions', {
        method: 'POST',
        body: {
          type: 'expense',
          description: `删除物品: ${names}`,
          gp_amount: 0,
          item_value: totalValue,
          note: deleteNote.value || ''
        }
      });
    }

    // Delete items
    for (const item of itemsToDelete) {
      await apiRequest(`/api/items/${item.id}`, { method: 'DELETE' });
    }

    const count = itemsToDelete.length;
    message.success(`已删除 ${count} 个物品${deleteAddTransaction.value ? '，流水记录已添加' : ''}`);

    if (deleteModalMode.value === 'batch') {
      selectedItemIds.value = [];
    }

    deleteModalShow.value = false;
    await Promise.all([loadItems(), loadCharacters(), loadTransactions()]);
  } catch (error) {
    message.error(error.message || '删除失败');
  }
}

// --- Data Loading ---
async function loadCharacters() {
  try {
    characters.value = await apiRequest('/api/characters');
    if (selectedCharId.value) {
      const ch = characters.value.find((x) => x.id === selectedCharId.value);
      if (ch) syncCharacterForm(ch);
    }
  } catch (error) {
    message.error(error.message || '加载角色失败');
  }
}

async function loadItems() {
  try {
    items.value = await apiRequest('/api/items');
  } catch (error) {
    message.error(error.message || '加载物品失败');
  }
}

async function loadLootRecords() {
  try {
    lootRecords.value = await apiRequest('/api/loot-records');
  } catch (error) {
    message.error(error.message || '加载Loot记录失败');
  }
}

async function loadTransactions() {
  try {
    const [list, summary] = await Promise.all([
      apiRequest('/api/transactions'),
      apiRequest('/api/transactions/summary')
    ]);
    transactions.value = list;
    txSummary.value = summary;
  } catch (error) {
    message.error(error.message || '加载流水记录失败');
  }
}

async function saveRecordMemo(record) {
  try {
    await apiRequest(`/api/loot-records/${record.id}/memo`, {
      method: 'PUT', body: { memo_text: record.memo_text || '' }
    });
    message.success('备忘录已保存');
  } catch (error) {
    message.error(error.message || '保存备忘录失败');
  }
}

async function removeLootRecord(record) {
  if (!window.confirm(`确认删除该Loot记录（${formatDate(record.created_at)}）？`)) return;
  try {
    await apiRequest(`/api/loot-records/${record.id}`, { method: 'DELETE' });
    expandedRecordIds.value = expandedRecordIds.value.filter((x) => x !== record.id);
    message.success('Loot记录已删除');
    await loadLootRecords();
  } catch (error) {
    message.error(error.message || '删除Loot记录失败');
  }
}

function formatDate(v) {
  if (!v) return '';
  return new Date(v).toLocaleString();
}

onMounted(async () => {
  await Promise.all([loadCharacters(), loadItems(), loadLootRecords(), loadTransactions()]);
  apiRequest('/api/app-config').then(data => {
    gmDisplayName.value = data.gm_display_name || 'GM';
  }).catch(() => {});
});
</script>

<style scoped>
.data-page { position: relative; }
.tab-content { padding-top: 16px; }

/* Action bar */
.action-bar {
  display: flex; gap: 8px; margin-bottom: 16px;
  flex-wrap: wrap; align-items: center;
}
.spacer { flex: 1; }

/* Table */
.table-wrap { overflow-x: auto; }

.fantasy-table {
  width: 100%; border-collapse: collapse;
}
.fantasy-table th {
  padding: 10px; font-size: 13px; color: var(--gold);
  border-bottom: 1px solid var(--border-strong);
  text-align: left; letter-spacing: 0.5px; white-space: nowrap;
}
.fantasy-table td {
  padding: 8px 10px; border-bottom: 1px solid rgba(201, 168, 76, 0.08);
  font-size: 14px; vertical-align: middle;
}
.fantasy-table tr:hover td { background: rgba(201, 168, 76, 0.04); }
.selected-row td { background: rgba(110, 92, 199, 0.08) !important; }

.type-badge {
  display: inline-block; padding: 1px 8px; border-radius: 12px; font-size: 12px;
  background: var(--arcane-glow); color: var(--arcane-bright); border: 1px solid var(--arcane-dim);
}
.type-badge.small { font-size: 10px; padding: 0 6px; }
.slot-badge {
  display: inline-block; padding: 1px 6px; border-radius: 12px; font-size: 11px;
  background: var(--gold-glow); color: var(--gold); border: 1px solid var(--gold-dim);
  margin-left: 4px;
}

.editable-cell {
  cursor: pointer; padding: 2px 4px; border-radius: 4px;
  transition: background 0.2s;
}
.editable-cell:hover { background: rgba(201, 168, 76, 0.1); }
.inline-edit { display: block; min-width: 60px; }

.remaining-cell {
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1.2;
}
.remaining-qty { color: var(--gold); font-weight: 600; }
.remaining-value { color: var(--text-secondary); font-size: 12px; }

.alloc-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.alloc-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 12px; font-size: 12px;
  border: 1px solid; color: var(--text-primary);
}
.tag-close {
  cursor: pointer; font-size: 10px; opacity: 0.6; transition: opacity 0.2s;
}
.tag-close:hover { opacity: 1; color: var(--danger); }

.action-btns { display: flex; gap: 4px; }

.icon-btn {
  background: transparent; border: 1px solid var(--border);
  color: var(--text-primary); width: 32px; height: 32px;
  border-radius: var(--radius); cursor: pointer; font-size: 14px;
  display: inline-grid; place-items: center; transition: all 0.2s;
}
.icon-btn:hover { border-color: var(--gold); background: var(--gold-glow); }
.icon-btn.danger:hover { border-color: var(--danger); background: var(--danger-soft); }
.icon-btn.small { width: 24px; height: 24px; font-size: 11px; }

/* Character layout */
.char-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 16px;
  min-height: 400px;
}
@media (max-width: 768px) {
  .char-layout { grid-template-columns: 1fr; }
}

.char-list-panel {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  overflow: hidden;
}
.char-list-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px; border-bottom: 1px solid var(--border);
}
.char-list-header .section-title { margin: 0; font-size: 14px; }
.char-list {
  max-height: 600px; overflow-y: auto;
}
.char-list-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; cursor: pointer;
  border-bottom: 1px solid rgba(201, 168, 76, 0.06);
  transition: all 0.2s;
}
.char-list-item:hover { background: rgba(201, 168, 76, 0.04); }
.char-list-item.active {
  background: rgba(201, 168, 76, 0.08);
  border-left: 3px solid var(--char-color, var(--gold));
}
.cli-avatar {
  width: 36px; height: 36px; border-radius: 50%; overflow: hidden;
  flex-shrink: 0; display: grid; place-items: center;
}
.cli-avatar img { width: 100%; height: 100%; object-fit: cover; }
.avatar-letter {
  width: 36px; height: 36px; border-radius: 50%;
  display: grid; place-items: center;
  font-family: 'Cinzel', serif; font-size: 16px; color: #fff; font-weight: 700;
}
.cli-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cli-name {
  font-weight: 600; font-size: 14px; color: var(--text-bright);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.char-detail-panel {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  padding: 16px;
  min-height: 300px;
}

.char-edit-content { display: flex; flex-direction: column; gap: 16px; padding-top: 8px; }
.char-form-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 640px) { .char-form-grid { grid-template-columns: 1fr; } }
.form-group { display: flex; flex-direction: column; gap: 4px; }
.form-label { font-size: 13px; color: var(--gold); letter-spacing: 0.5px; }
.form-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.upload-label {
  cursor: pointer; display: inline-flex; align-items: center;
  border: 1px dashed var(--border); padding: 4px 12px;
  border-radius: 8px; font-size: 12px; color: var(--text-secondary);
  transition: all 0.2s;
}
.upload-label:hover { border-color: var(--gold); color: var(--gold); }
.upload-label input { display: none; }

/* Char items */
.char-items-content { padding-top: 8px; }
.char-items-summary {
  padding: 8px 12px; background: var(--bg-elevated);
  border-radius: var(--radius); margin-bottom: 12px;
  font-size: 14px; color: var(--text-secondary);
}
.char-items-summary strong { color: var(--gold); }
.char-items-list { display: flex; flex-direction: column; gap: 4px; }
.char-item-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border: 1px solid var(--border);
  border-radius: var(--radius); font-size: 13px;
}
.ci-name { flex: 1; font-weight: 500; color: var(--text-bright); }
.ci-qty { color: var(--gold); }
.ci-price { color: var(--text-secondary); }
.ci-total { color: var(--arcane-bright); font-weight: 500; }

/* Buff */
.buff-content { padding-top: 8px; }
.buff-input-row {
  display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;
}
.buff-list { display: flex; flex-direction: column; gap: 6px; }
.buff-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border: 1px solid var(--border);
  border-radius: var(--radius); background: var(--bg-elevated);
}
.buff-level-tag {
  padding: 2px 8px; border-radius: 12px; font-size: 11px;
  background: var(--info-soft); color: var(--info);
  border: 1px solid rgba(41, 128, 185, 0.3); white-space: nowrap;
}
.buff-name { font-weight: 500; color: var(--text-bright); }

/* Transactions */
.tx-summary {
  display: flex; gap: 16px; font-size: 14px;
}
.tx-s-income { color: #2ecc71; }
.tx-s-expense { color: #e74c3c; }
.tx-s-consume { color: #e67e22; }
.tx-s-balance { font-weight: 600; }
.tx-s-balance.positive { color: #2ecc71; }
.tx-s-balance.negative { color: #e74c3c; }

.tx-list {
  display: flex; flex-direction: column; gap: 10px;
}
.tx-card {
  padding: 14px; position: relative;
  border-left: 3px solid var(--border);
}
.tx-card.income { border-left-color: #2ecc71; }
.tx-card.expense { border-left-color: #e74c3c; }
.tx-card.consume,
.tx-card.consume-group { border-left-color: #e67e22; }
.tx-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 6px;
}
.tx-type-badge {
  font-size: 12px; padding: 2px 10px;
  border-radius: 12px; font-weight: 600;
}
.tx-type-badge.income { background: rgba(46, 204, 113, 0.12); color: #2ecc71; }
.tx-type-badge.expense { background: rgba(231, 76, 60, 0.12); color: #e74c3c; }
.tx-type-badge.consume { background: rgba(230, 126, 34, 0.14); color: #e67e22; }
.tx-date { font-size: 12px; color: var(--text-secondary); }
.tx-desc { font-weight: 500; color: var(--text-bright); margin-bottom: 6px; }
.tx-amounts { display: flex; gap: 16px; font-size: 13px; color: var(--text-secondary); }
.tx-total { color: var(--gold); font-weight: 600; }
.tx-note { font-size: 12px; margin-top: 4px; }
.tx-actions { position: absolute; top: 10px; right: 10px; }
.consume-group .tx-actions {
  position: static;
  margin-top: 10px;
}
.tx-group-detail {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tx-subitem {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(230, 126, 34, 0.16);
  border-radius: var(--radius);
  background: rgba(230, 126, 34, 0.05);
}
.tx-subitem-main {
  min-width: 0;
  flex: 1;
}
.tx-subitem-desc {
  color: var(--text-bright);
  font-size: 13px;
  font-weight: 500;
}
.tx-subitem-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}

.tx-form { display: flex; flex-direction: column; gap: 14px; }
.form-row { display: flex; gap: 12px; }
.flex-1 { flex: 1; }
.batch-type-form { display: flex; flex-direction: column; }
.split-form { display: flex; flex-direction: column; }
.merge-form { display: flex; flex-direction: column; gap: 8px; }
.merge-items-list {
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px;
}
.merge-item-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px;
  border-radius: 6px;
}
.merge-item-option:hover { background: rgba(201, 168, 76, 0.05); }
.merge-item-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.merge-item-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
}

/* New character form inside modal */
.new-char-form { display: flex; flex-direction: column; gap: 12px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; }

.alloc-form { display: flex; flex-direction: column; gap: 14px; }
.alloc-item-name {
  font-family: 'Cinzel', 'LXGW WenKai', serif;
  font-size: 16px; color: var(--gold);
}

/* Loot records */
.loot-records-list { display: flex; flex-direction: column; gap: 12px; }
.loot-record-card { padding: 16px; }
.lr-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.lr-header-right { display: flex; align-items: center; gap: 10px; }
.lr-date { font-family: 'Cinzel', serif; color: var(--gold); font-size: 14px; }
.lr-total-value { font-size: 13px; color: var(--gold); font-weight: 600; }
.lr-note-line { margin-bottom: 8px; font-size: 13px; }

/* Loot record items */
.lr-items-section { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
.lr-item-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 8px; font-size: 13px;
  border-bottom: 1px solid rgba(201, 168, 76, 0.06);
}
.lr-item-name { flex: 1; font-weight: 500; color: var(--text-bright); }
.lr-item-qty { color: var(--gold); min-width: 40px; }
.lr-item-price { color: var(--text-secondary); min-width: 60px; }
.lr-item-subtotal { color: var(--arcane-bright); font-weight: 500; min-width: 80px; text-align: right; }

/* Loot record allocations */
.lr-alloc-section {
  margin: 8px 0; padding: 8px 10px;
  background: var(--bg-elevated); border-radius: var(--radius);
  border: 1px solid var(--border);
}
.lr-alloc-title { font-size: 12px; color: var(--gold); margin-bottom: 4px; letter-spacing: 0.5px; }
.lr-alloc-row {
  display: flex; align-items: center; gap: 6px;
  padding: 2px 0; font-size: 12px; color: var(--text-secondary);
}
.lr-alloc-item-name { color: var(--text-primary); }
.lr-alloc-arrow { color: var(--gold); }
.lr-alloc-char { color: var(--arcane-bright); font-weight: 500; }
.lr-alloc-qty { color: var(--gold); }

/* Loot record gold */
.lr-gold-section { display: flex; gap: 8px; flex-wrap: wrap; margin: 6px 0; }
.lr-gold-tag {
  font-size: 12px; padding: 2px 10px;
  border-radius: 12px; background: var(--gold-glow); color: var(--gold);
  border: 1px solid var(--gold-dim);
}

/* Loot record value summary */
.lr-value-summary {
  display: flex; gap: 16px; font-size: 13px;
  padding: 6px 0; color: var(--text-secondary);
  border-top: 1px solid var(--border);
  margin-top: 6px;
}
.lr-value-summary span:last-child { color: var(--gold); font-weight: 600; }

/* Loot record edit section */
.lr-edit-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }

/* Empty states */
.empty-state {
  display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 32px; color: var(--text-secondary);
}
.empty-state.small { padding: 12px; font-size: 13px; }
.empty-icon { font-size: 40px; opacity: 0.4; }
.muted { color: var(--text-secondary); font-size: 13px; }

/* Delete confirmation */
.delete-confirm-form { display: flex; flex-direction: column; gap: 4px; }
.delete-confirm-msg {
  font-size: 15px; color: var(--text-bright); line-height: 1.6;
}
</style>
