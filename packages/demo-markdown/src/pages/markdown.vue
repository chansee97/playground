<script setup lang="ts">
/**
 * 演示页面：所见即所得 Markdown 编辑器
 *
 * 页面只承载编辑器本身（含可选工具栏），Markdown 源码通过工具栏的「源码」
 * 开关在同一块画布上原地切换，不额外占一列展示。
 */
import { NButton, NSpace, NSwitch, useMessage } from 'naive-ui'
import { computed, ref, shallowRef } from 'vue'
import EditorToolbar from '../components/EditorToolbar.vue'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import type { MilkupEditor, ShortcutActionId } from '../core'
import { sampleMarkdown } from '../sample'

const message = useMessage()

const markdown = ref(sampleMarkdown)
const sourceView = ref(false)
const readonly = ref(false)

const editorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null)
// MilkupEditor 是带私有成员的类，必须用 shallowRef 才能保持其名义类型
const editorInstance = shallowRef<MilkupEditor | null>(null)

const lineCount = computed(() => markdown.value.split('\n').length)
const charCount = computed(() => markdown.value.length)

const shortcuts: Array<{ keys: string, label: string }> = [
  { keys: 'Ctrl/⌘ + B', label: '粗体' },
  { keys: 'Ctrl/⌘ + I', label: '斜体' },
  { keys: 'Ctrl/⌘ + 1~3', label: '标题' },
  { keys: 'Ctrl/⌘ + /', label: '源码视图' },
  { keys: 'Ctrl/⌘ + F', label: '查找替换' },
  { keys: 'Tab / Enter', label: '列表续写 / 跳出' },
]

function onReady(editor: MilkupEditor) {
  editorInstance.value = editor
}

function onAction(id: ShortcutActionId) {
  editorRef.value?.execAction(id)
}

function resetSample() {
  markdown.value = sampleMarkdown
  editorRef.value?.setMarkdown(sampleMarkdown)
  message.success('已重置为示例文档')
}

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(editorRef.value?.getMarkdown() ?? '')
    message.success('Markdown 已复制到剪贴板')
  }
  catch {
    message.error('当前环境不支持剪贴板写入')
  }
}
</script>

<template>
  <div class="md-demo">
    <header class="md-demo-head">
      <div class="md-demo-title">
        <h2>所见即所得 Markdown 编辑器</h2>
        <p>ProseMirror 即时渲染内核：Markdown 标记即文档内容，装饰层按光标位置决定其显隐</p>
      </div>
      <n-space align="center">
        <n-switch v-model:value="readonly" size="small">
          <template #checked>只读</template>
          <template #unchecked>可编辑</template>
        </n-switch>
        <n-button size="small" @click="resetSample">
          重置示例
        </n-button>
        <n-button size="small" type="primary" @click="copyMarkdown">
          复制 Markdown
        </n-button>
      </n-space>
    </header>

    <section class="md-demo-pane">
      <EditorToolbar
        :editor="editorInstance"
        :source-view="sourceView"
        :readonly="readonly"
        @action="onAction"
        @update:source-view="value => (sourceView = value)"
      />
      <MarkdownEditor
        ref="editorRef"
        v-model="markdown"
        v-model:source-view="sourceView"
        :readonly="readonly"
        placeholder="在这里书写 Markdown，例如输入 # 或 - 试试…"
        min-height="620px"
        @ready="onReady"
      />

      <footer class="md-demo-shortcuts">
        <span v-for="item in shortcuts" :key="item.keys" class="md-demo-shortcut">
          <kbd>{{ item.keys }}</kbd>
          <span>{{ item.label }}</span>
        </span>
        <span class="md-demo-counter">{{ charCount }} 字符 / {{ lineCount }} 行</span>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.md-demo {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 12px;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 4px;
}

.md-demo-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.md-demo-title h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.md-demo-title p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--gh-fg-subtle, #818b98);
}

/* 统计信息挂在底部快捷键条尾部，靠 margin-left 顶到最右 */
.md-demo-counter {
  margin-left: auto;
  font-size: 11px;
  color: var(--gh-fg-subtle, #818b98);
  white-space: nowrap;
}

.md-demo-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--gh-border-default, #d1d9e0);
  border-radius: 6px;
  overflow: hidden;
  background: var(--gh-canvas-default, #fff);
}

.md-demo-shortcuts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  padding: 8px 12px;
  border-top: 1px solid var(--gh-border-default, #d1d9e0);
  background: var(--gh-canvas-muted, #f6f8fa);
}

.md-demo-shortcut {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--gh-fg-muted, #59636e);
}

/* GitHub kbd 风格：等宽 11px、6px 圆角、内凹下边 */
.md-demo-shortcut kbd {
  display: inline-block;
  padding: 3px 6px;
  font-family: var(--milkup-font-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px;
  line-height: 10px;
  color: var(--gh-fg-default, #1f2328);
  vertical-align: middle;
  background: var(--gh-canvas-muted, #f6f8fa);
  border: 1px solid var(--gh-border-muted, rgba(209, 217, 224, 0.7));
  border-radius: 6px;
  box-shadow: inset 0 -1px 0 var(--gh-border-muted, rgba(209, 217, 224, 0.7));
  white-space: nowrap;
}
</style>

<route lang="json">
{
  "meta": {
    "title": "Markdown 编辑器"
  }
}
</route>
