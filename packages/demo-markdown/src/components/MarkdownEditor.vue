<script setup lang="ts">
/**
 * MarkdownEditor —— 所见即所得 Markdown 编辑器核心组件
 *
 * 只做一件事：把 `src/core` 里的 ProseMirror 即时渲染内核包装成 Vue 组件。
 * 不包含工具栏、不包含任何业务逻辑，宿主通过 props / 事件 / 暴露的方法驱动。
 *
 * ```vue
 * <MarkdownEditor v-model="md" placeholder="开始书写…" @ready="onReady" />
 * ```
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { buildActionCommandMap, createMilkupEditor, type MilkupEditor, type ShortcutActionId } from '../core'
// 内核不再副作用 import 样式，样式由这一层（宿主）负责：
// 内核样式 + 主题变量 + 公式渲染所需的 KaTeX 样式
import '../core/styles/milkup.css'
import '../styles/editor-theme.css'
import 'katex/dist/katex.min.css'

/** 动作命令表：工具栏与快捷键共用同一套命令 */
type ActionCommandMap = ReturnType<typeof buildActionCommandMap>

const props = withDefaults(defineProps<{
  /** Markdown 源码（v-model） */
  modelValue?: string
  /** 空文档时的占位提示 */
  placeholder?: string
  /** 只读模式 */
  readonly?: boolean
  /** 源码视图（显示所有 Markdown 标记） */
  sourceView?: boolean
  /** 编辑器最小高度 */
  minHeight?: string
  /** 挂载后自动聚焦 */
  autofocus?: boolean
}>(), {
  modelValue: '',
  placeholder: '',
  readonly: false,
  sourceView: false,
  minHeight: '520px',
  autofocus: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:sourceView': [value: boolean]
  change: [value: string]
  ready: [editor: MilkupEditor]
  focus: []
  blur: []
}>()

/** 滚动容器（同时是编辑器默认样式的定位上下文） */
const scrollEl = ref<HTMLElement>()
/** ProseMirror 挂载点 */
const editEl = ref<HTMLElement>()

const editor = shallowRef<MilkupEditor>()
let actionCommands: ActionCommandMap | null = null

function syncSourceView(value: boolean) {
  emit('update:sourceView', value)
}

onMounted(() => {
  if (!editEl.value) return

  const instance = createMilkupEditor(editEl.value, {
    content: props.modelValue,
    readonly: props.readonly,
    sourceView: props.sourceView,
    placeholder: props.placeholder || undefined,
  })

  editor.value = instance
  actionCommands = buildActionCommandMap(instance.getSchema())

  instance.on('change', (data: { markdown: string }) => {
    emit('update:modelValue', data.markdown)
    emit('change', data.markdown)
  })

  // 源码视图由 Ctrl+/ 等快捷键切换时，把状态同步回宿主
  instance.view.dom.addEventListener('focus', () => emit('focus'))
  instance.view.dom.addEventListener('blur', () => emit('blur'))
  instance.view.dom.ownerDocument.addEventListener('keydown', handleSourceViewShortcut, true)

  if (props.autofocus) instance.focus()
  emit('ready', instance)
})

onBeforeUnmount(() => {
  editor.value?.view.dom.ownerDocument.removeEventListener(
    'keydown',
    handleSourceViewShortcut,
    true,
  )
  editor.value?.destroy()
  editor.value = undefined
  actionCommands = null
})

/** 快捷键切换源码视图后，把内核状态同步回 v-model */
function handleSourceViewShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key !== '/') return
  const instance = editor.value
  if (!instance?.view.hasFocus()) return
  queueMicrotask(() => {
    if (instance.isSourceViewEnabled() !== props.sourceView) {
      syncSourceView(instance.isSourceViewEnabled())
    }
  })
}

// 外部内容变化 → 回填（相同内容不重写文档，避免打断输入与撤销栈）
watch(() => props.modelValue, (value) => {
  const instance = editor.value
  if (!instance || value === instance.getMarkdown()) return
  instance.setMarkdown(value)
})

watch(() => props.readonly, value => editor.value?.updateConfig({ readonly: value }))

watch(() => props.sourceView, (value) => {
  const instance = editor.value
  if (instance && instance.isSourceViewEnabled() !== value) instance.updateConfig({ sourceView: value })
})

/** 执行一个动作（工具栏与外部宿主共用） */
function execAction(id: ShortcutActionId): boolean {
  const instance = editor.value
  const command = actionCommands?.[id]
  if (!instance || !command) return false
  const handled = command(instance.view.state, instance.view.dispatch.bind(instance.view))
  if (handled) instance.focus()
  return handled
}

/** 当前选区是否处于指定状态（用于工具栏高亮） */
function isActive(id: ShortcutActionId): boolean {
  const instance = editor.value
  const command = actionCommands?.[id]
  if (!instance || !command) return false
  return command(instance.view.state)
}

function focus() {
  editor.value?.focus()
}

function getMarkdown(): string {
  return editor.value?.getMarkdown() ?? ''
}

function setMarkdown(value: string) {
  editor.value?.setMarkdown(value)
}

function toggleSourceView() {
  editor.value?.toggleSourceView()
  syncSourceView(editor.value?.isSourceViewEnabled() ?? false)
}

function scrollToTop() {
  if (scrollEl.value) scrollEl.value.scrollTop = 0
}

defineExpose({
  /** 内核实例，需要更底层能力时直接使用 */
  editor,
  execAction,
  isActive,
  focus,
  getMarkdown,
  setMarkdown,
  toggleSourceView,
  scrollToTop,
})
</script>

<template>
  <div class="md-editor-shell" :style="{ '--md-editor-min-height': minHeight }">
    <div ref="scrollEl" class="scrollView md-editor-scroll">
      <div ref="editEl" class="md-editor-host" />
    </div>
  </div>
</template>

<style scoped>
.md-editor-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--background-color);
}

.md-editor-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  position: relative;
  scroll-behavior: auto;
}

.md-editor-host {
  position: relative;
  display: flex;
  min-height: var(--md-editor-min-height);
}
</style>
