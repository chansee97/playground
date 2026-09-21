/**
 * @playground/demo-markdown 公共出口
 *
 * - 核心组件：`MarkdownEditor`（所见即所得编辑器）、`EditorToolbar`（可选工具栏）
 * - 内核能力：`src/core` 下的解析 / 序列化 / 命令 / 装饰 / NodeView 等全部导出
 */

export { default as MarkdownEditor } from './components/MarkdownEditor.vue'
export { default as EditorToolbar } from './components/EditorToolbar.vue'

export * from './core'
