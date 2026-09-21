/**
 * 测试用文档结构导出工具。
 *
 * 内核的架构是「Markdown 标记即真实文本节点」，所以文档里同时存在两类信息：
 *   - 语义结构：段落 / 标题 / 列表 / 强调 …（应当符合 CommonMark / GFM）
 *   - 语法标记：`**`、`#`、`- ` 等带 syntax_marker 的文本节点（实现细节）
 *
 * 因此这里提供两个视图：
 *   - `semantic()` 丢掉所有 syntax_marker 文本，只留语义 —— 用来对照规范断言
 *   - `raw()`      保留全部节点与 mark —— 用来断言「标记确实是文本」这一架构不变量
 */
import type { Node as PMNode } from 'prosemirror-model'
import { parseMarkdown } from '../../core/parser'
import { serializeMarkdown } from '../../core/serializer'
import { decodeHtmlEntity, HTML_ENTITY_SYNTAX_TYPE } from '../../core/utils/html-entities'

/** 语义 mark 的短名；syntax_marker 属于实现细节，不参与语义视图 */
const MARK_ALIAS: Record<string, string> = {
  strong: 'strong',
  emphasis: 'em',
  code_inline: 'code',
  strikethrough: 'del',
  highlight: 'mark',
  sub: 'sub',
  sup: 'sup',
}

const NODE_ALIAS: Record<string, string> = {
  doc: 'doc',
  paragraph: 'p',
  blockquote: 'quote',
  horizontal_rule: 'hr',
  bullet_list: 'ul',
  ordered_list: 'ol',
  list_item: 'li',
  task_list: 'tasks',
  table: 'table',
  table_row: 'tr',
  table_header: 'th',
  table_cell: 'td',
  math_block: 'math',
  html_block: 'html',
  hard_break: 'br',
  frontmatter: 'frontmatter',
}

type Part =
  | { kind: 'text', text: string, marks: string[] }
  | { kind: 'node', label: string, children: Part[] }

/**
 * 定义块（引用式链接 / 脚注的定义原文）是元数据，不参与渲染，
 * 语义视图按与 syntax_marker 相同的原则丢弃 —— 保证 `semantic()` 只反映可见语义。
 * 原文仍真实存在于文档中，序列化时逐字节还原。
 */
const METADATA_NODES = new Set(['link_definition'])

/** mark attr 只可能是字符串或 null，这里收口避免 Object 默认字符串化 */
function attrText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function markLabel(mark: { type: { name: string }, attrs: Record<string, unknown> }): string {
  const name = mark.type.name
  if (name === 'link') return `link:${attrText(mark.attrs.href)}`
  if (name === 'math_inline') return `math:${attrText(mark.attrs.content)}`
  if (name === 'html_inline') return `html:${attrText(mark.attrs.tag)}`
  if (name === 'footnote_ref') return `fn:${attrText(mark.attrs.id)}`
  if (name === 'image') return `img:${attrText(mark.attrs.src)}`
  return MARK_ALIAS[name] ?? name
}

function nodeHeader(node: PMNode): string {
  switch (node.type.name) {
    case 'heading':
      return `h${node.attrs.level}`
    case 'code_block':
      return node.attrs.indented ? 'code-indented' : `code:${node.attrs.language || ''}`
    case 'ordered_list':
      return `ol:${node.attrs.start}`
    case 'task_item':
      return node.attrs.checked ? 'task:x' : 'task:o'
    case 'blockquote':
      return node.attrs.alertType ? `quote:${attrText(node.attrs.alertType)}` : 'quote'
    default:
      return NODE_ALIAS[node.type.name] ?? node.type.name
  }
}

/**
 * 软换行（hard_break + raw "\n"）在语义上就是段落内的一个换行符，
 * 按文本还原，保证语义视图与 CommonMark 一致（真正的硬换行仍显示为 `br`）。
 */
function isSoftBreak(node: PMNode): boolean {
  return node.type.name === 'hard_break' && node.attrs.raw === '\n'
}

/** 把 ProseMirror 节点树收敛成 Part 树，顺带丢掉不参与该视图的文本 */
function collect(node: PMNode, withMarkers: boolean): Part | null {
  if (METADATA_NODES.has(node.type.name)) return null

  if (isSoftBreak(node)) {
    return { kind: 'text', text: '\n', marks: [] }
  }

  if (node.isText) {
    if (!withMarkers) {
      const syntaxMark = node.marks.find(m => m.type.name === 'syntax_marker')
      if (syntaxMark) {
        // HTML 实体在文档里以源码形式（`&copy;`）保存、由装饰层渲染成字符，
        // 语义视图取解码后的字符才符合规范语义。
        if (syntaxMark.attrs.syntaxType === HTML_ENTITY_SYNTAX_TYPE) {
          const decoded = decodeHtmlEntity(node.text ?? '')
          return { kind: 'text', text: decoded ?? (node.text ?? ''), marks: [] }
        }
        return { kind: 'text', text: '', marks: [] }
      }
    }
    return {
      kind: 'text',
      text: node.text ?? '',
      marks: node.marks
        .map(markLabel)
        .toSorted(),
    }
  }

  const children: Part[] = []
  node.forEach((child) => {
    const part = collect(child, withMarkers)
    if (part) children.push(part)
  })

  return { kind: 'node', label: nodeHeader(node), children }
}

/** 合并相邻的同 mark 文本节点，避免断言里出现碎片 */
function merge(parts: Part[]): Part[] {
  const out: Part[] = []
  for (const part of parts) {
    const prev = out[out.length - 1]
    if (
      part.kind === 'text'
      && prev?.kind === 'text'
      && prev.marks.join(',') === part.marks.join(',')
    ) {
      prev.text += part.text
      continue
    }
    out.push(part)
  }
  return out
}

/**
 * 渲染为紧凑字符串。
 *
 * 只对「块容器首尾那一个纯文本节点」做首尾去空白：
 * 这是标记被丢弃后残留的分隔空格（如 `#` 与标题之间的空格），不属于语义。
 * 块内部的空格（`a **b** c` 里的 "a " / " c"）原样保留。
 */
function render(parts: Part[], dim: boolean): string {
  const trimmed = merge(parts)

  const trimFirst = (): void => {
    while (trimmed.length) {
      const first = trimmed[0]
      if (first.kind !== 'text') return
      first.text = dim ? first.text.trimStart() : first.text
      if (!first.text) trimmed.shift()
      else return
    }
  }
  const trimLast = (): void => {
    while (trimmed.length) {
      const last = trimmed[trimmed.length - 1]
      if (last.kind !== 'text') return
      last.text = dim ? last.text.trimEnd() : last.text
      if (!last.text) trimmed.pop()
      else return
    }
  }
  const firstText = trimmed[0]
  const lastText = trimmed[trimmed.length - 1]
  if (dim && firstText?.kind === 'text') trimFirst()
  if (dim && lastText?.kind === 'text') trimLast()

  const out: string[] = []
  for (const part of trimmed) {
    if (part.kind === 'text') {
      if (!part.text) continue
      const text = JSON.stringify(part.text)
      out.push(part.marks.length ? `${text}{${part.marks.join(',')}}` : text)
    }
    else {
      const inner = render(part.children, true)
      out.push(inner ? `${part.label}(${inner})` : part.label)
    }
  }
  return out.join(' ')
}

function shape(node: PMNode, withMarkers: boolean): string {
  // 去掉根 doc 包装，断言里只关心内容
  const parts: Part[] = []
  node.forEach((child) => {
    const part = collect(child, withMarkers)
    if (part) parts.push(part)
  })
  return render(parts, false)
}

/** 解析 Markdown 并导出纯语义结构（忽略语法标记） */
export function semantic(markdown: string): string {
  return shape(parseMarkdown(markdown).doc, false)
}

/** 解析 Markdown 并导出完整结构（含语法标记文本） */
export function raw(markdown: string): string {
  return shape(parseMarkdown(markdown).doc, true)
}

/** 解析 → 序列化 */
export function round(markdown: string): string {
  return serializeMarkdown(parseMarkdown(markdown).doc)
}

/** 收集文档里所有 syntax_marker 文本，用于断言「标记是真实文本」 */
export function markers(markdown: string): string[] {
  const found: string[] = []
  parseMarkdown(markdown).doc.descendants((node) => {
    if (node.isText && node.marks.some(m => m.type.name === 'syntax_marker')) {
      found.push(node.text ?? '')
    }
    return true
  })
  return found
}
