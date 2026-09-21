<script setup lang="ts">
/**
 * EditorToolbar —— 可选工具栏
 *
 * 与核心组件是松耦合的：只依赖内核实例暴露的 ProseMirror 状态，
 * 点击后把动作 ID 抛给宿主执行（宿主调用 MarkdownEditor 的 execAction）。
 */
import { NButton, NDivider, NSwitch, NTooltip } from 'naive-ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { MilkupEditor, ShortcutActionId } from '../core'

const props = withDefaults(defineProps<{
  editor?: MilkupEditor | null
  sourceView?: boolean
  readonly?: boolean
}>(), {
  editor: null,
  sourceView: false,
  readonly: false,
})

const emit = defineEmits<{
  action: [id: ShortcutActionId]
  'update:sourceView': [value: boolean]
}>()

/** 选区每次变化都重新求值按钮的激活态 */
const revision = ref(0)
let offHandlers: Array<() => void> = []

watch(() => props.editor, (editor) => {
  offHandlers.forEach(off => off())
  offHandlers = []
  if (!editor) return
  const bump = () => revision.value++
  editor.on('change', bump)
  editor.on('selectionChange', bump)
  offHandlers.push(() => {
    editor.off('change', bump)
    editor.off('selectionChange', bump)
  })
  bump()
}, { immediate: true })

onBeforeUnmount(() => offHandlers.forEach(off => off()))

interface ToolButton {
  id: ShortcutActionId
  label: string
  title: string
}

const inlineButtons: ToolButton[] = [
  { id: 'toggleStrong', label: 'B', title: '粗体' },
  { id: 'toggleEmphasis', label: 'I', title: '斜体' },
  { id: 'toggleStrikethrough', label: 'S', title: '删除线' },
  { id: 'toggleCodeInline', label: '</>', title: '行内代码' },
  { id: 'toggleHighlight', label: '==', title: '高亮' },
]

const blockButtons: ToolButton[] = [
  { id: 'setHeading1', label: 'H1', title: '一级标题' },
  { id: 'setHeading2', label: 'H2', title: '二级标题' },
  { id: 'setHeading3', label: 'H3', title: '三级标题' },
  { id: 'setParagraph', label: '¶', title: '正文段落' },
  { id: 'wrapInBlockquote', label: '❝', title: '引用' },
  { id: 'wrapInBulletList', label: '•', title: '无序列表' },
  { id: 'wrapInOrderedList', label: '1.', title: '有序列表' },
  { id: 'setCodeBlock', label: '{ }', title: '代码块' },
]

const insertButtons: ToolButton[] = [
  { id: 'insertHorizontalRule', label: '—', title: '分割线' },
  { id: 'insertTable', label: '▦', title: '表格' },
  { id: 'insertMathBlock', label: '∑', title: '数学公式块' },
]

const historyButtons: ToolButton[] = [
  { id: 'undo', label: '↶', title: '撤销' },
  { id: 'redo', label: '↷', title: '重做' },
]

/** mark 类动作 ↔ schema 中的 mark 名 */
const markActions: Array<{ id: ShortcutActionId, mark: string }> = [
  { id: 'toggleStrong', mark: 'strong' },
  { id: 'toggleEmphasis', mark: 'emphasis' },
  { id: 'toggleStrikethrough', mark: 'strikethrough' },
  { id: 'toggleCodeInline', mark: 'code_inline' },
  { id: 'toggleHighlight', mark: 'highlight' },
]

/** 依赖 revision 重新计算当前激活的动作集合 */
const activeIds = computed<Set<ShortcutActionId>>(() => {
  const editor = props.editor
  const active = new Set<ShortcutActionId>()
  // 读取 revision 让计算属性随选区变化失效
  void revision.value
  if (!editor) return active

  const { state } = editor.view
  const { from, to, empty, $from } = state.selection
  const schema = editor.getSchema()

  for (const { id, mark } of markActions) {
    const markType = schema.marks[mark]
    if (!markType) continue
    const hit = empty
      ? $from.marks().some(mark => mark.type === markType)
      : state.doc.rangeHasMark(from, to, markType)
    if (hit) active.add(id)
  }

  const parent = $from.parent
  if (parent.type.name === 'heading') {
    const level = parent.attrs.level as number
    if (level >= 1 && level <= 3) active.add(`setHeading${level}` as ShortcutActionId)
  }
  else if (parent.type.name === 'paragraph') {
    active.add('setParagraph')
  }
  if (parent.type.name === 'code_block') active.add('setCodeBlock')

  for (let depth = $from.depth; depth > 0; depth--) {
    const nodeName = $from.node(depth).type.name
    if (nodeName === 'blockquote') active.add('wrapInBlockquote')
    if (nodeName === 'bullet_list') active.add('wrapInBulletList')
    if (nodeName === 'ordered_list') active.add('wrapInOrderedList')
  }

  return active
})

function onAction(id: ShortcutActionId) {
  emit('action', id)
}
</script>

<template>
  <div class="editor-toolbar">
    <template v-for="button in inlineButtons" :key="button.id">
      <n-tooltip trigger="hover" :delay="300">
        <template #trigger>
          <n-button
            size="small"
            quaternary
            :type="activeIds.has(button.id) ? 'primary' : 'default'"
            :disabled="readonly"
            @mousedown.prevent
            @click="onAction(button.id)"
          >
            {{ button.label }}
          </n-button>
        </template>
        {{ button.title }}
      </n-tooltip>
    </template>

    <n-divider vertical />

    <template v-for="button in blockButtons" :key="button.id">
      <n-tooltip trigger="hover" :delay="300">
        <template #trigger>
          <n-button
            size="small"
            quaternary
            :type="activeIds.has(button.id) ? 'primary' : 'default'"
            :disabled="readonly"
            @mousedown.prevent
            @click="onAction(button.id)"
          >
            {{ button.label }}
          </n-button>
        </template>
        {{ button.title }}
      </n-tooltip>
    </template>

    <n-divider vertical />

    <template v-for="button in insertButtons" :key="button.id">
      <n-tooltip trigger="hover" :delay="300">
        <template #trigger>
          <n-button
            size="small"
            quaternary
            :disabled="readonly"
            @mousedown.prevent
            @click="onAction(button.id)"
          >
            {{ button.label }}
          </n-button>
        </template>
        {{ button.title }}
      </n-tooltip>
    </template>

    <n-divider vertical />

    <template v-for="button in historyButtons" :key="button.id">
      <n-tooltip trigger="hover" :delay="300">
        <template #trigger>
          <n-button
            size="small"
            quaternary
            :disabled="readonly"
            @mousedown.prevent
            @click="onAction(button.id)"
          >
            {{ button.label }}
          </n-button>
        </template>
        {{ button.title }}
      </n-tooltip>
    </template>

    <div class="editor-toolbar-spacer" />

    <n-tooltip trigger="hover" :delay="300">
      <template #trigger>
        <n-switch
          size="small"
          :value="sourceView"
          @update:value="value => emit('update:sourceView', value)"
        >
          <template #checked>源码</template>
          <template #unchecked>即时渲染</template>
        </n-switch>
      </template>
      源码视图会显示所有 Markdown 标记符号（Ctrl+/）
    </n-tooltip>
  </div>
</template>

<style scoped>
.editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--gh-border-default, #d1d9e0);
  background: var(--gh-canvas-muted, #f6f8fa);
}

.editor-toolbar-spacer {
  flex: 1;
}
</style>
