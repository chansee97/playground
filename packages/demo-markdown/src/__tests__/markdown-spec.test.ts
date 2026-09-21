/**
 * 内核规范符合性测试（对照 CommonMark 0.31 + GFM）。
 *
 * 五条轨道：
 *   1. 语义结构   —— 断言 AST 结构符合规范，全部用 `semantic()` 视图
 *   2. 往返保真   —— 解析→序列化必须稳定（且对规范形输入必须逐字节还原）
 *   3. 架构不变量 —— 标记确实是文档里的真实文本节点
 *   4. 视图切换   —— 源码视图来回切换不留哨兵字符、选区不越界
 *   5. 样式契约   —— 源码视图下不泄漏渲染态样式（上游 #243）
 *
 * 注意断言写法：本内核的块级结构是节点、行内格式是 mark 挂在文本上
 * （`**粗体**` → `"粗体"{strong}`），这是「标记即文本」架构的直接结果。
 *
 * 为什么必须有轨道 1：早期只做往返测试，漏掉了大量「往返一致但语义错误」
 * 的情况（例如 `* * *` 被解析成嵌套列表、`` ``a`b`` `` 解析错乱）。
 */
import { EditorState, TextSelection } from 'prosemirror-state'
import type { Transaction } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { describe, expect, it, vi } from 'vitest'
import {
  createDecorationPlugin,
  decorationPluginKey,
  toggleSourceView,
} from '../core/decorations'
import { buildShortcutBindings, createShortcutConfigSource } from '../core/keymap/dynamic-keymap'
import { createViewGroupedRegistry, sourceViewRegistry } from '../core/nodeviews/view-registry'
import { DEFAULT_SHORTCUTS } from '../core/keymap/shortcut-registry'
import { parseMarkdown } from '../core/parser'
import {
  blockquoteAlertSyncPluginKey,
  createBlockquoteAlertSyncPlugin,
} from '../core/plugins/blockquote-alert-sync'
import { createLocalStoragePasteAdapter } from '../core/plugins/paste'
import {
  convertBlocksToParagraphs,
  convertParagraphsToBlocks,
  createSourceViewTransformPlugin,
} from '../core/plugins/source-view-transform'
import { createSyntaxDetectorPlugin } from '../core/plugins/syntax-detector'
import {
  classifyTag,
  isDangerousUrl,
  sanitizeAttributes,
} from '../core/utils/html-sanitize'
import milkupCss from '../core/styles/milkup.css?raw'
import { mapPositionByTextAnchor } from '../core/utils/text-position'
import { sampleMarkdown } from '../sample'
import { markers, raw, round, semantic } from './helpers/ast'

/**
 * 取出装饰挂的 class。
 *
 * `Decoration.type` 没有暴露在 prosemirror-view 的公开 d.ts 里，
 * 只能按运行时形状读出来——这里是为了断言「隐藏态 / 显形态」确实换了 class。
 */
function decorationClass(decoration: { from: number; to: number }): string {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 读 prosemirror-view 未公开的字段
  const type = (decoration as unknown as { type?: { attrs?: Record<string, unknown> } }).type
  const value = type?.attrs?.class
  return typeof value === 'string' ? value : ''
}

/** 文档里最后一个文本节点的末端位置（删除测试用） */
function lastTextEnd(doc: PMNode): number {
  let end = 0
  doc.descendants((node, pos) => {
    if (node.isText) end = pos + node.nodeSize
    return true
  })
  return end
}

/** 收集带 image mark 的文本 */
function imageMarkedText(doc: PMNode): string[] {
  const found: string[] = []
  doc.descendants((node) => {
    if (node.isText && node.marks.some(m => m.type.name === 'image')) found.push(node.text ?? '')
    return true
  })
  return found
}

/**
 * 解析文档并取出告示块插件算出的装饰集。
 *
 * 光标显式停在文末：`Selection.atStart` 会落在告示块首段起点（正好压在标记上），
 * 那是「光标在标记上」的显形态，不能用来代表静止渲染态。
 */
function alertDecorations(markdown: string) {
  const { doc } = parseMarkdown(markdown)
  const state = EditorState.create({
    doc,
    selection: TextSelection.near(doc.resolve(doc.content.size), -1),
    plugins: [createBlockquoteAlertSyncPlugin()],
  })
  const set = blockquoteAlertSyncPluginKey.getState(state)
  if (!set) throw new Error('告示块插件状态缺失')
  return { doc, set }
}

/**
 * 模拟「光标从 from 移到 to」这一次选区事务，返回插件吸附后的落点。
 * 告示标记是结构标记，插件会把落在标记内部的选区按方向弹出边界。
 */
function alertSnapHead(markdown: string, from: number, to: number): number {
  const { doc } = parseMarkdown(markdown)
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, from),
    plugins: [createBlockquoteAlertSyncPlugin()],
  })
  const next = state.apply(state.tr.setSelection(TextSelection.create(doc, to)))
  return next.selection.head
}

/** 同上，但把光标放到 doc 中的绝对位置 pos：用于验证标记随光标显隐 */
function alertDecorationsAt(markdown: string, pos: number) {
  const { doc } = parseMarkdown(markdown)
  const state = EditorState.create({
    doc,
    selection: TextSelection.near(doc.resolve(pos)),
    plugins: [createBlockquoteAlertSyncPlugin()],
  })
  const set = blockquoteAlertSyncPluginKey.getState(state)
  if (!set) throw new Error('告示块插件状态缺失')
  return { doc, set }
}

/** 块级语义断言表：[名称, 输入, 期望结构] */
const blockCases: Array<[name: string, md: string, expected: string]> = [
  ['软换行属于同一段落', 'a\nb\n', 'p("a\\nb")'],
  ['空行分隔两个段落', 'a\n\nb\n', 'p("a") p("b")'],
  ['ATX 标题', '# 标题\n', 'h1("标题")'],
  ['ATX 标题剥离闭合 #', '# Title #\n', 'h1("Title")'],
  ['标题允许最多 3 个前导空格', '   # Title\n', 'h1("Title")'],
  ['# 单独成行是空标题', '#\n', 'h1'],
  ['ATX 六级标题', '###### t\n', 'h6("t")'],
  ['Setext 一级标题', 'Title\n=====\n', 'h1("Title")'],
  ['Setext 二级标题', 'Title\n-----\n', 'h2("Title")'],
  ['星号分隔线（带空格）', '* * *\n', 'hr'],
  ['减号分隔线（带空格）', '- - -\n', 'hr'],
  ['下划线分隔线', '___\n', 'hr'],
  ['紧排分隔线', '***\n', 'hr'],
  ['引用块', '> a\n', 'quote(p("a"))'],
  ['引用块惰性续行', '> a\nb\n', 'quote(p("a\\nb"))'],
  ['引用块多行', '> a\n> b\n', 'quote(p("a\\nb"))'],
  ['缩进代码块', '    code\n', 'code-indented("code")'],
  ['围栏代码块', '```js\na\n```\n', 'code:js("a")'],
  ['波浪围栏代码块', '~~~py\nb\n~~~\n', 'code:py("b")'],
  ['front-matter', '---\ntitle: x\n---\n', 'frontmatter("title: x")'],
  ['HTML 注释是 HTML 块', '<!-- c -->\n', 'html("<!-- c -->")'],
  ['HTML 标签块', '<div>\nhi\n</div>\n', 'html("<div>\\nhi\\n</div>")'],
  ['无序列表', '- a\n- b\n', 'ul(li(p("a")) li(p("b")))'],
  ['有序列表', '1. a\n2. b\n', 'ol:1(li(p("a")) li(p("b")))'],
  ['有序列表起始序号', '3. a\n4. b\n', 'ol:3(li(p("a")) li(p("b")))'],
  ['嵌套列表', '- a\n  - b\n', 'ul(li(p("a") ul(li(p("b")))))'],
  ['任务列表', '- [x] a\n- [ ] b\n', 'tasks(task:x(p("a")) task:o(p("b")))'],
  ['表格', '| a | b |\n| --- | --- |\n| 1 | 2 |\n', 'table(tr(th("a") th("b")) tr(td("1") td("2")))'],
  ['表格允许无外侧竖线', 'a | b\n--- | ---\n1 | 2\n', 'table(tr(th("a") th("b")) tr(td("1") td("2")))'],
  ['表格单元格转义竖线不拆列', '| a \\| b | c |\n| --- | --- |\n', 'table(tr(th("a | b") th("c")))'],
  ['表格单元格内换行写成 <br>', '| a<br>b |\n| --- |\n', 'table(tr(th("a" br "b")))'],
  ['块级公式', '$$\nx\n$$\n', 'math("x")'],
  ['块之间的标准空行不产生空段落', 'text\n\n---\n\nmore\n', 'p("text") hr p("more")'],
]

/** 行内语义断言表：格式表现为 mark */
const inlineCases: Array<[name: string, md: string, expected: string]> = [
  ['粗体', '**粗体**\n', 'p("粗体"{strong})'],
  ['下划线粗体', '__粗体__\n', 'p("粗体"{strong})'],
  ['斜体', '*斜体*\n', 'p("斜体"{em})'],
  ['删除线', '~~删除~~\n', 'p("删除"{del})'],
  ['GFM 单波浪删除线', '~删除~\n', 'p("删除"{del})'],
  ['高亮（扩展语法）', '==高亮==\n', 'p("高亮"{mark})'],
  ['行内代码', '`code`\n', 'p("code"{code})'],
  ['行内代码可含反引号（多反引号定界）', 'a ``b`c`` d\n', 'p("a " "b`c"{code} " d")'],
  ['强调与粗体嵌套', '*foo**bar**baz*\n', 'p("foo"{em} "bar"{em,strong} "baz"{em})'],
  ['词内下划线不构成强调', 'foo_bar_baz\n', 'p("foo_bar_baz")'],
  ['行内数学公式', '$E=mc^2$\n', 'p("E=mc^2"{math:E=mc^2})'],
  ['链接', '[a](http://x)\n', 'p("a"{link:http://x})'],
  ['链接 title 支持双引号', '[a](http://x "t")\n', 'p("a"{link:http://x})'],
  ['链接 title 支持单引号', "[a](http://x 't')\n", 'p("a"{link:http://x})'],
  ['Autolink 尖括号', '<https://example.com>\n', 'p("https://example.com"{link:https://example.com})'],
  ['GFM 裸链接自动识别', 'https://example.com\n', 'p("https://example.com"{link:https://example.com})'],
  ['行尾两空格是硬换行', 'a  \nb\n', 'p("a" br "b")'],
  ['行尾反斜杠是硬换行', 'a\\\nb\n', 'p("a" br "b")'],
  ['转义 ASCII 标点', '\\%\\&\\#\n', 'p("%&#")'],
  ['转义星号不构成强调', '\\*not em\\*\n', 'p("*not em*")'],
  ['HTML 实体', '&copy; &amp;\n', 'p("© &")'],
  ['行内 HTML 标签包裹内容', 'a <span style="color:red">b</span> c\n', 'p("a " "b"{html:span} " c")'],
  ['下标', 'H<sub>2</sub>O\n', 'p("H" "2"{sub} "O")'],
  ['上标', 'x<sup>2</sup>\n', 'p("x" "2"{sup})'],
  ['独立成行的图片：语法是真实文本', '![alt](x.png)\n', 'p("![alt](x.png)"{img:x.png})'],
  ['链接图片：整段语法带外层链接', '[![alt](x.png)](http://y)\n', 'p("[![alt](x.png)](http://y)"{img:x.png})'],
  ['同一行连续图片：各自带 mark', '![a](1.png)![b](2.png)\n', 'p("![a](1.png)"{img:1.png} "![b](2.png)"{img:2.png})'],
  ['图片随文：前后都能夹文字', 'text ![alt](x.png) text\n', 'p("text " "![alt](x.png)"{img:x.png} " text")'],
]

/** 规范形输入：解析→序列化必须逐字节还原 */
const byteExactCases: Array<[name: string, md: string]> = [
  ['段落与软换行', 'a\nb\n'],
  ['多段落', 'p1\n\np2\n'],
  ['ATX 标题', '## 标题\n'],
  ['Setext 标题', 'Title\n=====\n'],
  ['紧排分隔线', '***\n'],
  ['星号分隔线（带空格）', '* * *\n'],
  ['引用块', '> a\n'],
  ['引用块多行', '> a\n> b\n'],
  ['缩进代码块', '    code\n'],
  ['围栏代码块', '```js\nconst a = 1\n```\n'],
  ['波浪围栏代码块', '~~~py\nb\n~~~\n'],
  ['front-matter', '---\ntitle: x\n---\n'],
  ['无序列表（减号）', '- a\n- b\n'],
  ['无序列表（星号）', '* a\n'],
  ['无序列表（加号）', '+ a\n'],
  ['有序列表', '1. a\n2. b\n'],
  ['有序列表起始序号', '3. a\n'],
  ['有序列表右括号分隔符', '1) a\n'],
  ['嵌套列表', '- a\n  - b\n'],
  ['任务列表', '- [x] a\n- [ ] b\n'],
  ['表格', '| a | b |\n| --- | --- |\n| 1 | 2 |\n'],
  ['表格对齐标记', '| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n'],
  ['删除线与高亮', '~~a~~ ==b==\n'],
  ['行内代码与转义', 'a `b` c \\* d\n'],
  ['粗斜体嵌套', '**a** *b* ***c***\n'],
  ['链接与图片', '[a](http://x) ![b](y.png)\n'],
  ['图片随文（前后夹文字）', 'demo ![1](1.png) demo ![2](2.png) demo\n'],
  ['HTML 块', '<div>\nhi\n</div>\n'],
  ['行内 HTML', 'a <span>b</span> c\n'],
  ['HTML 实体', 'a &copy; b\n'],
  ['引用式链接定义与引用', '[a]: http://x\n\n[a]\n'],
  ['引用式链接定义（含 title）', '[a]: http://x "t"\n\n[a]\n'],
  ['完整形态的引用式链接', '[a][b]\n\n[b]: http://x\n'],
  ['未定义的引用保持原文', '[a]\n'],
  ['连续的定义之间没有空行', '[a]: http://x\n[b]: http://y\n'],
  ['GFM 脚注定义与引用', 'a[^1]\n\n[^1]: note\n'],
  ['GFM 多行脚注定义', 'a[^1]\n\n[^1]: line1\n    line2\n'],
  ['硬换行', 'a  \nb\n'],
  ['长文档综合', '# T\n\n> q1\n> q2\n\n- l1\n- l2\n\n| h |\n| --- |\n| c |\n\n```js\nx\n```\n'],
]

describe('块级结构（对照 CommonMark / GFM）', () => {
  it.each(blockCases)('%s', (_name, md, expected) => {
    expect(semantic(md)).toBe(expected)
  })
})

describe('行内结构（对照 CommonMark / GFM）', () => {
  it.each(inlineCases)('%s', (_name, md, expected) => {
    expect(semantic(md)).toBe(expected)
  })
})

describe('往返保真', () => {
  it.each(byteExactCases)('逐字节还原：%s', (_name, md) => {
    expect(round(md)).toBe(md)
  })

  it.each([...blockCases, ...inlineCases])('序列化结果稳定（幂等）：%s', (_name, md) => {
    const once = round(md)
    expect(round(once)).toBe(once)
  })
})

describe('架构不变量：标记是文档里的真实文本', () => {  it('ATX 标题的 # 是文本节点，分隔空格保留为普通文本', () => {
    expect(raw('# 标题\n')).toBe('h1("#"{syntax_marker} " 标题")')
  })

  it('粗体定界符是文本节点', () => {
    expect(markers('**粗体**\n')).toEqual(['**', '**'])
  })

  it('块级结构本身不产生标记文本（列表标记由渲染层负责）', () => {
    expect(markers('- a\n- b\n')).toEqual([])
  })

  it('语义视图丢弃标记后仍能还原内容', () => {
    expect(semantic('这是**粗体**文本\n')).toBe('p("这是" "粗体"{strong} "文本")')
  })
})

/**
 * 告示块是「解析器 + 插件 + 装饰」三段拼起来的，容易静默失效：
 * 解析器负责给 blockquote 打 alertType，插件负责隐藏 `[!NOTE]` 标记并挂图标。
 * 这里把两段都钉住。
 */
describe('引用告示块', () => {  it.each([
    ['marker 与正文同段', '> [!NOTE]\n> 正文\n', 'note'],
    ['marker 独占整段', '> [!TIP]\n', 'tip'],
  ])('%s：alertType 被解析出来', (_name, md, expected) => {
    const first = parseMarkdown(md).doc.firstChild
    expect(first?.type.name).toBe('blockquote')
    expect(first?.attrs.alertType).toBe(expected)
  })

  it.each(['> [!WARNING]\n> 正文\n', '> [!CAUTION]\n> 正文\n', '> [!IMPORTANT]\n>\n> 正文\n'])(
    '%s：装饰恰好隐藏标记本身',
    (md) => {
      const { doc, set } = alertDecorations(md)
      const found = set.find()

      // 一个零宽 widget（图标）+ 一个非零宽 inline（隐藏标记）
      const widget = found.filter(d => d.from === d.to)
      const hidden = found.filter(d => d.to > d.from)
      expect(widget).toHaveLength(1)
      expect(hidden).toHaveLength(1)

      // 关键不变量：隐藏区间必须正好等于 `[!TYPE]`，多一个字符就会把正文也藏掉
      expect(doc.textBetween(hidden[0].from, hidden[0].to)).toMatch(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/)
      // 图标插在标记之前
      expect(widget[0].from).toBe(hidden[0].from)
    },
  )

  /**
   * 标记是**结构标记**（与 `> ` 续行前缀同类），不是可编辑文本：
   * 它必须是段落首部的 `[!TYPE]`，改一个字就会连带毁掉 `\n> ` 续行、
   * 告示样式与正文。所以它恒隐藏（不随光标显形），光标由插件吸附跳过。
   */
  it('标记恒隐藏，任何光标位置都不显形', () => {
    const md = '> [!NOTE]\n> 正文\n'
    const { set: idle } = alertDecorations(md)
    const marker = idle.find().find(d => d.to > d.from)
    if (!marker) throw new Error('告示标记缺失')

    for (const pos of [marker.from, marker.from + 1, marker.to]) {
      const { doc, set } = alertDecorationsAt(md, pos)
      const found = set.find()

      // 标题 widget 一直在
      expect(found.filter(d => d.from === d.to)).toHaveLength(1)

      const inline = found.filter(d => d.to > d.from)
      expect(inline).toHaveLength(1)
      expect([inline[0].from, inline[0].to]).toEqual([marker.from, marker.to])
      expect(decorationClass(inline[0])).toContain('milkup-blockquote-alert-marker-hidden')
      expect(doc.textBetween(inline[0].from, inline[0].to)).toBe('[!NOTE]')
    }
  })

  /**
   * 光标落入标记内部时必须被吸附出去，否则它会停在一个 0 号字、
   * contenteditable=false 的区间里：既看不见，回车/删除还会毁掉结构。
   * 方向决定落点，等效于「箭头跳过这个原子」。
   */
  it('光标进入标记内部时按方向吸附到边界', () => {
    const md = '> [!NOTE]\n> 正文\n'
    const { set: idle } = alertDecorations(md)
    const marker = idle.find().find(d => d.to > d.from)
    if (!marker) throw new Error('告示标记缺失')

    // 从左往右进入 → 落到标记之后（正文开头）
    expect(alertSnapHead(md, marker.from - 1, marker.from + 1)).toBe(marker.to)
    // 从右往左进入 → 落到标记之前
    expect(alertSnapHead(md, marker.to + 1, marker.to - 1)).toBe(marker.from)
    // 停在边界上不算「内部」，不动
    expect(alertSnapHead(md, marker.to + 1, marker.to)).toBe(marker.to)
  })

  it('非告示块的引用不产生任何告示装饰', () => {
    const { set } = alertDecorations('> 普通引用\n')
    expect(set.find()).toHaveLength(0)
  })

  it('标记与正文同段时，标记行之后是软换行节点', () => {
    const md = '> [!NOTE]\n> 正文\n'
    const { doc } = parseMarkdown(md)
    const paragraph = doc.firstChild?.firstChild

    // 软换行是节点（不是裸 "\n" 文本），删除标记行时按节点边界计算
    const shape: string[] = []
    paragraph?.forEach((child) => shape.push(child.isText ? `text:${child.text}` : child.type.name))
    expect(shape[0]).toBe('text:[!NOTE]')
    expect(shape[1]).toBe('hard_break')
  })
})

describe('端到端：演示示例文档', () => {
  it('示例文档逐字节往返一致', () => {
    expect(round(sampleMarkdown)).toBe(sampleMarkdown)
  })

  /**
   * 示例文档是「所有可展示语法」的清单，这里逐项断言它确实覆盖到了。
   * 新增语法时同步往这张表里加一行，示例与能力不会脱节。
   */
  const coverage: Array<[语法: string, 片段: string]> = [
    // 块级
    ['front matter', 'frontmatter('],
    ['ATX 标题 1~6 级', 'h1("一级标题")'],
    ['ATX 标题 6 级', 'h6("六级标题")'],
    ['Setext 一级标题', 'h1("Setext 一级标题")'],
    ['Setext 二级标题', 'h2("Setext 二级标题")'],
    ['软换行', 'p("这一段演示软换行：源码里写成两行，\\n渲染后属于同一个段落。")'],
    ['硬换行', '" br "'],
    ['引用块', 'quote(p("普通引用块的第一段。") p("引用块里的第二段。"))'],
    ['嵌套引用', 'quote(p("嵌套引用：") quote(p("内层引用的内容。")))'],
    ['告示块 NOTE', 'quote:note('],
    ['告示块 TIP', 'quote:tip('],
    ['告示块 IMPORTANT', 'quote:important('],
    ['告示块 WARNING', 'quote:warning('],
    ['告示块 CAUTION', 'quote:caution('],
    ['无序列表', 'ul(li(p("无序列表第一项")) li(p("无序列表第二项")))'],
    ['星号 / 加号列表', 'ul(li(p("星号作为列表符号")))'],
    ['有序列表', 'ol:1(li(p("有序列表第一项")) li(p("有序列表第二项")))'],
    ['有序列表起始序号', 'ol:3(li(p("右括号分隔符与自定义起始序号")))'],
    ['嵌套列表', 'ul(li(p("一级列表项") ul(li(p("二级列表项") ul(li(p("三级列表项"))))))'],
    ['任务列表', 'tasks(task:x(p("已完成的任务")) task:o(p("待办的任务")))'],
    ['松散任务列表', 'tasks(task:x(p("已完成的任务")) task:o(p("待办的任务")))'],
    ['表格', 'table(tr(th("左对齐") th("居中") th("右对齐") th("默认"))'],
    ['表格单元格硬换行', 'td("第一行" br "第二行")'],
    ['围栏代码块', 'code:typescript('],
    ['带 info string 的围栏', 'code:js('],
    ['波浪围栏代码块', 'code:python('],
    ['缩进式代码块', 'code-indented('],
    ['Mermaid 代码块', 'code:mermaid('],
    ['数学块', 'math('],
    ['HTML 块', 'html("<div'],
    ['独立图片', 'img:https://placehold.co/720x200/png?text=Markdown+Editor'],
    ['链接图片', 'img:https://placehold.co/260x90/png?text=Linked+Image'],
    ['同行连续图片', '{img:https://placehold.co/140x60/png?text=1} "![连续图片二]'],
    ['图片与文字混排', 'img:https://placehold.co/90x40/png?text=Inline'],

    // 行内
    ['粗体', '"粗体"{strong}'],
    ['下划线粗体', '"下划线粗体"{strong}'],
    ['斜体', '"斜体"{em}'],
    ['下划线斜体', '"下划线斜体"{em}'],
    ['粗斜体', '"粗斜体"{em,strong}'],
    ['删除线', '"删除线"{del}'],
    ['单波浪删除线', '"单波浪删除线"{del}'],
    ['高亮', '"高亮"{mark}'],
    ['行内代码', '"行内代码"{code}'],
    ['含反引号的行内代码', '"含反引号 ` 的代码"{code}'],
    ['双引号标题链接', '"双引号标题链接"{link:https://prosemirror.net}'],
    ['单引号标题链接', '"单引号标题链接"{link:https://prosemirror.net}'],
    ['引用式链接', '"ProseMirror 官网"{link:https://prosemirror.net}'],
    ['引用式链接（第二个定义）', '"内核文档"{link:https://prosemirror.net/docs/}'],
    ['GFM 脚注引用', '"spec"{fn:spec}'],
    ['Autolink', '"https://example.com"{link:https://example.com}'],
    ['GFM 裸链接', '"https://example.com"{link:https://example.com}'],
    ['行内公式', '{math:E = mc^2}'],
    ['下标', '"2"{sub}'],
    ['上标', '"2"{sup}'],
    ['行内 HTML', '"这一段由 HTML 标签渲染"{html:span}'],
    ['HTML 实体', 'HTML 实体：©'],
    ['转义字符', '转义字符：* _ # % & $ ~ ='],
  ]

  it.each(coverage)('示例文档覆盖：%s', (_syntax, fragment) => {
    expect(semantic(sampleMarkdown)).toContain(fragment)
  })

  it('示例文档包含三种分隔线写法', () => {
    const shape = semantic(sampleMarkdown)
    expect(shape.match(/(?:^|[\s(])hr(?=[\s)]|$)/g)).toHaveLength(3)
  })

  it('示例文档包含四类代码块与三种列表符号', () => {
    const raw = sampleMarkdown
    for (const token of ['```typescript', '```js title=demo.js', '~~~python', '    const answer = 42', '```mermaid']) {
      expect(raw).toContain(token)
    }
    for (const marker of ['\n- 无序列表第一项', '\n* 星号作为列表符号', '\n+ 加号作为列表符号']) {
      expect(raw).toContain(marker)
    }
  })
})

/**
 * 插件管线回归。
 *
 * appendTransaction 里的位置计算一旦越界（例如用 `pos + node.nodeSize` 当扫描上界，
 * 会比文本块内容末端多 2），`state.apply` 会直接抛异常、事务整体失效——
 * 表现是「所有编辑操作静默失效」：删除键只剩光标左移、打字不落盘。
 * 这类问题只能靠「跑一次真实事务」的断言抓住。
 */
describe('插件管线：文档变更不抛异常', () => {
  const cases: Array<[name: string, md: string]> = [
    ['末尾是普通段落', '# 标题\n\n正文段落\n'],
    ['末尾是含图片语法的段落', '文字 ![a](x.png) 之后\n'],
    ['末尾是列表', '- a\n- b\n'],
    ['末尾是代码块', '文字\n\n```js\ncode\n```\n'],
    ['末尾是引用块', '> 引用\n'],
  ]

  it.each(cases)('%s：删除最后一个字符生效', (_name, md) => {
    const { doc } = parseMarkdown(md)
    const state = EditorState.create({ doc, plugins: [createSyntaxDetectorPlugin()] })

    const end = lastTextEnd(doc)
    const next = state.apply(state.tr.delete(end - 1, end))
    expect(next.doc.textContent.length).toBe(doc.textContent.length - 1)
  })
})

describe('行内图片 mark 的维护（syntax-detector）', () => {
  it('打字产生的图片语法会被打上 mark', () => {
    const { doc } = parseMarkdown('文字 之后\n')
    const state = EditorState.create({ doc, plugins: [createSyntaxDetectorPlugin()] })

    // 在「文字 」之后插入图片语法
    const next = state.apply(state.tr.insertText('![a](x.png)', 4))
    expect(imageMarkedText(next.doc)).toEqual(['![a](x.png)'])
  })

  it('改坏语法后 mark 被摘掉，原文保留', () => {
    const { doc } = parseMarkdown('文字 ![a](x.png) 之后\n')
    const state = EditorState.create({ doc, plugins: [createSyntaxDetectorPlugin()] })
    expect(imageMarkedText(state.doc)).toEqual(['![a](x.png)'])

    // 删掉右括号（token 共 11 字符，右括号在最后）：语法失效
    const from = doc.textContent.indexOf('![a](x.png)') + 1
    const next = state.apply(state.tr.delete(from + 10, from + 11))
    expect(imageMarkedText(next.doc)).toEqual([])
    expect(next.doc.textContent).toContain('![a](x.png')
  })
})

/**
 * Setext 标题的下划线是一长串 `=`，天然撞上行内高亮语法 `==text==`。
 * 一旦被当成高亮，每次编辑都会给下划线加/摘 highlight mark：
 * 表现为标题下划线闪烁，甚至被 syntax-fixer 摘掉 mark 后整行露出来。
 */
describe('Setext 标题与行内高亮的冲突（syntax-detector）', () => {
  it('下划线不会被识别成 ==高亮==', () => {
    const { doc } = parseMarkdown('Title\n=====\n')
    const state = EditorState.create({ doc, plugins: [createSyntaxDetectorPlugin()] })

    // 在标题文字末尾敲一个字符，触发一次全量语法检测
    const next = state.apply(state.tr.insertText('X', 6))

    const marksOnEquals = new Set<string>()
    next.doc.descendants((node) => {
      if (node.isText && (node.text ?? '').includes('=')) {
        node.marks.forEach(m => marksOnEquals.add(m.type.name))
      }
      return true
    })

    expect([...marksOnEquals]).not.toContain('highlight')
    // 下划线仍然带着标题语法标记（隐藏态），没有被摘掉
    expect([...marksOnEquals]).toContain('syntax_marker')
  })
})

/**
 * 引用式链接与 GFM 脚注。
 *
 * 引用点渲染成语义 mark（link / footnote_ref），定义原文由 `link_definition`
 * 块承载：语义视图里丢弃（它不是可见内容），序列化时逐字节还原（它是用户原文）。
 */
describe('引用式链接与 GFM 脚注', () => {
  it('引用式链接定义与引用', () => {
    expect(semantic('[a]: http://x\n\n[a]\n')).toBe('p("a"{link:http://x})')
  })

  it('完整形态的引用式链接 `[a][b]` 也解析到定义', () => {
    expect(semantic('[a][b]\n\n[b]: http://x\n')).toBe('p("a"{link:http://x})')
  })

  it('未定义的引用不产生 link mark，原文保留', () => {
    expect(semantic('[a]\n')).toBe('p("[a]")')
  })

  // 定义之间带不带空行在 AST 上无法区分，统一收敛到「紧挨着」，且必须幂等
  it('连续定义之间的空行被收敛掉', () => {
    const once = round('[a]: http://x\n\n[b]: http://y\n')
    expect(once).toBe('[a]: http://x\n[b]: http://y\n')
    expect(round(once)).toBe(once)
  })

  it('GFM 脚注引用', () => {
    expect(semantic('a[^1]\n\n[^1]: note\n')).toBe('p("a" "1"{fn:1})')
  })
})

/** 哨兵用私有使用区字符包裹（\uE000 … \uE001），一旦泄漏就会成为可见乱码 */
const SENTINEL = /[\uE000-\uF8FF]/

/** 造一个带装饰 + 源码视图转换插件的状态，光标放在 pos */
function createSourceState(md: string, pos: number): EditorState {
  const { doc } = parseMarkdown(md)
  return EditorState.create({
    doc,
    selection: TextSelection.near(doc.resolve(pos)),
    plugins: [createDecorationPlugin(), createSourceViewTransformPlugin()],
  })
}

/** 进入源码视图再退回，返回最终状态 */
function toggleTwice(state: EditorState): EditorState {
  let current = state
  const dispatch = (tr: Transaction): void => {
    current = current.apply(tr)
  }
  toggleSourceView(current, dispatch)
  toggleSourceView(current, dispatch)
  return current
}

/**
 * 源码视图切换：文档完整性与选区合法性。
 *
 * 切换源码视图是「整体替换文档内容 + 用哨兵字符定位光标」的组合拳，最怕两种事故：
 *   1. 哨兵（私有使用区字符）没被摘掉，永久留在用户文档里变成乱码；
 *   2. 选区被映射到越界位置，后续编辑直接抛异常。
 * 两者都只在「真的跑一次事务」时才暴露，所以这里对代表性文档逐位置来回切换。
 */
describe('源码视图切换：哨兵不残留、选区不越界', () => {
  it.each([
    ['相邻引用块（切换会生成分隔空段）', '> a\n\n> b\n'],
    ['围栏代码块（进出各重建一次）', '文字\n\n```js\ncode\n```\n'],
    ['表格（按行列重建）', '| a |\n| --- |\n| 1 |\n'],
    ['列表与任务列表', '- a\n- [x] b\n'],
    ['告示块', '> [!NOTE]\n> 正文\n'],
    // 不含行内公式/图片：它们的渲染 widget 需要真实 DOM，不在 node 环境单测范围内
    ['行内语法', 'a **b** `c` ==d==\n'],
  ])('%s：每个光标位置来回切换后都干净', (_name, md) => {
    const { doc } = parseMarkdown(md)

    for (let pos = 1; pos < doc.content.size; pos++) {
      const after = toggleTwice(createSourceState(md, pos))
      expect(after.doc.textContent).not.toMatch(SENTINEL)
      expect(after.selection.from).toBeGreaterThanOrEqual(0)
      expect(after.selection.to).toBeLessThanOrEqual(after.doc.content.size)
    }
  })

  /**
   * 专门钉住最容易出事的那个位置：源码视图里相邻引用块之间的**分隔空段**。
   * 它就是靠「空文本 + blockquoteSeparator 属性」被识别出来的，
   * 一旦哨兵被插进去，textContent 就不再为空，退出源码视图时这一行会被当成普通段落。
   */
  it('光标停在源码视图的分隔空段上，来回切换也不留下哨兵', () => {
    const md = '> a\n\n> b\n'
    const { doc } = parseMarkdown(md)
    let state = EditorState.create({
      doc,
      selection: TextSelection.near(doc.resolve(3)),
      plugins: [createDecorationPlugin(), createSourceViewTransformPlugin()],
    })
    const dispatch = (tr: Transaction): void => {
      state = state.apply(tr)
    }

    toggleSourceView(state, dispatch)

    let separatorPos = -1
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.attrs.blockquoteSeparator) {
        separatorPos = pos + 1
        return false
      }
      return true
    })
    expect(separatorPos).toBeGreaterThan(0)

    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(separatorPos))))
    toggleSourceView(state, dispatch)

    expect(state.doc.textContent).not.toMatch(SENTINEL)
  })
})

/**
 * 样式契约（上游 #243）。
 *
 * 行内代码的 DOM 拆成两半：反引号在 `.milkup-syntax` 里，内容单独带
 * `code_inline`。渲染态给内容挂了 chip（背景 + 边框 + inline-block + 阴影），
 * 源码视图必须把它整体重置掉，否则会看到「内容有框、反引号没有」的错位。
 * 内核测试只钉住这条契约：具体的 px/颜色仍由样式表自由决定。
 */
describe('源码视图的样式重置（#243）', () => {
  it('源码视图下重置行内代码的 chip 样式', () => {
    const declarations = declarationsOf(
      /\.milkup-editor\.source-view[^{}]*\.milkup-code-inline[^{}]*\{([^}]*)\}/,
    )

    expect(declarations).toContain('display:inline')
    expect(declarations).toContain('background:transparent')
    expect(declarations).toContain('border:none')
    expect(declarations).toContain('box-shadow:none')
  })
})

/**
 * 把 CSS 声明体规范化成 `prop:value;prop:value`，避免被换行缩进影响断言。
 */
function declarationsOf(sourceViewRule: RegExp): string {
  const body = sourceViewRule.exec(milkupCss)?.[1] ?? ''
  return body
    .split(';')
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(part => part.replace(/\s*:\s*/, ':'))
    .join(';')
}

/** 解析 Markdown 取文档（跨文档映射用例用） */
function docOf(md: string): PMNode {
  return parseMarkdown(md).doc
}

/** 某个快捷键动作的默认绑定键 */
function defaultKeyOf(id: 'toggleStrong' | 'toggleEmphasis'): string {
  return DEFAULT_SHORTCUTS.find(shortcut => shortcut.id === id)!.defaultKey
}

/** 取装饰插件状态里的装饰集 */
function decorationsOf(state: EditorState) {
  const pluginState = decorationPluginKey.getState(state)
  if (!pluginState) throw new Error('装饰插件状态缺失')
  return pluginState.decorations
}

/** 切换一次源码视图，返回最终状态与 docChanged */
function toggleOnce(state: EditorState): { state: EditorState, docChanged: boolean } {
  let current = state
  let changed = false
  const dispatch = (tr: Transaction): void => {
    changed = tr.docChanged
    current = current.apply(tr)
  }
  toggleSourceView(current, dispatch)
  return { state: current, docChanged: changed }
}

/** 取出事务里 ReplaceStep 的替换区间（转换只应产生一个 step） */
function stepRanges(tr: Transaction): Array<{ from: number, to: number }> {
  const ranges: Array<{ from: number, to: number }> = []
  for (const step of tr.steps) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- from/to 只存在于 ReplaceStep 等具体子类，基类 Step 未暴露
    const range = step as unknown as { from?: number, to?: number }
    if (typeof range.from === 'number' && typeof range.to === 'number') {
      ranges.push({ from: range.from, to: range.to })
    }
  }
  return ranges
}

/** 找到 `needle` 在文档里结束处的绝对位置（测试里用来定位光标） */
function positionAfter(doc: PMNode, needle: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.isText && (node.text ?? '').includes(needle)) {
      found = pos + (node.text ?? '').indexOf(needle) + needle.length
      return false
    }
    return true
  })
  if (found === -1) throw new Error(`文档里找不到 ${needle}`)
  return found
}

/** 最后一个顶层块的起始位置 */
function lastBlockStart(doc: PMNode): number {
  let offset = 0
  doc.forEach((_node, nodeOffset) => {
    offset = nodeOffset
  })
  return offset
}

/**
 * `setMarkdown` 的光标映射。
 *
 * 整篇替换的 StepMap 会把选区塌缩掉，于是 `setMarkdown` 需要自己把光标搬回去。
 * 这里钉住「文本锚点映射」这一层的语义：同文档同位置、光标前插入内容后随语义平移、
 * 内容整体换掉时退化到就近的合法位置。
 */
describe('跨文档光标映射（setMarkdown 用）', () => {
  it('文档不变时映射回同一个位置', () => {
    const doc = docOf(`${'a'.repeat(40)}\n\n${'b'.repeat(40)}\n`)
    const pos = positionAfter(doc, 'b'.repeat(20))
    expect(mapPositionByTextAnchor(doc, pos, doc)).toBe(pos)
  })

  it('光标之前插入内容后，落点跟着语义平移', () => {
    const before = docOf(`${'A'.repeat(40)}\n\n目标段落内容\n`)
    const after = docOf(`新插入的一段\n\n${'A'.repeat(40)}\n\n目标段落内容\n`)

    const mapped = mapPositionByTextAnchor(before, positionAfter(before, '目标'), after)
    expect(mapped).toBe(positionAfter(after, '目标'))
  })

  it('内容整体换掉时退化为就近的合法位置', () => {
    const before = docOf(`${'a'.repeat(40)}\n`)
    const after = docOf('完全不同的一份文档\n')
    expect(mapPositionByTextAnchor(before, 30, after)).toBe(Math.min(30, after.content.size))
  })

  it('锚点不足（光标在文档开头）时退化为就近位置且不越界', () => {
    const before = docOf('abc\n')
    const after = docOf('xyz\n')
    expect(mapPositionByTextAnchor(before, 1, after)).toBe(Math.min(1, after.content.size))
  })
})

/**
 * 快捷键配置快照。
 *
 * 动态 keymap 的按键路径原本每次都要「读 localStorage + JSON.parse + JSON.stringify」，
 * 现在收口成一个可失效的稳定快照：热路径上只剩一次对象身份比较。
 */
describe('快捷键配置快照（按键热路径）', () => {
  it('未失效时返回同一引用，且只读一次配置', () => {
    let reads = 0
    const source = createShortcutConfigSource(() => {
      reads++
      return { toggleStrong: 'Mod-b' }
    })

    const first = source.get()
    expect(source.get()).toBe(first)
    expect(reads).toBe(1)
  })

  it('invalidate 之后重新读取', () => {
    let reads = 0
    const source = createShortcutConfigSource(() => ({ toggleStrong: `Mod-${++reads}` }))

    expect(source.get().toggleStrong).toBe('Mod-1')
    source.invalidate()
    expect(source.get().toggleStrong).toBe('Mod-2')
    expect(reads).toBe(2)
  })

  it('展开绑定：缺省回落默认键，显式置空表示解绑', () => {
    const commands = { toggleStrong: () => true, toggleEmphasis: () => true }
    const bindings = buildShortcutBindings(
      { toggleStrong: 'Mod-b', toggleEmphasis: null },
      commands,
    )

    expect(Object.keys(bindings)).toEqual(['Mod-b'])
    expect(Object.keys(bindings)).not.toContain(defaultKeyOf('toggleEmphasis'))
  })
})

/**
 * 装饰集的复用。
 *
 * 装饰对选区的依赖被压缩成「光标上下文指纹」：指纹没变就整块复用上一次的
 * DecorationSet。钉住这条快路径，避免有人把指纹依赖改漏（那会表现为装饰不刷新）。
 */
describe('装饰集按光标指纹复用', () => {
  it('光标在同一段纯文本里移动时复用装饰集', () => {
    const { doc } = parseMarkdown(`普通文字。\n\n**粗体**\n\n又有文字。\n`)
    const start = lastBlockStart(doc)
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, start + 1),
      plugins: [createDecorationPlugin()],
    })

    const before = decorationsOf(state)
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start + 3)))
    expect(decorationsOf(next)).toBe(before)
  })

  it('光标跨入语法标记时装饰集必须重建', () => {
    const { doc } = parseMarkdown(`前面 **粗体** 后面\n`)
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
      plugins: [createDecorationPlugin()],
    })

    const before = decorationsOf(state)
    const next = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, positionAfter(state.doc, '粗'))),
    )
    expect(decorationsOf(next)).not.toBe(before)
  })
})

/**
 * 源码视图转换：只替换真正变化的区间。
 *
 * 早期是「整篇 ReplaceStep」：选区一定被塌缩（所以要用哨兵字符找回）、DOM 一定重建
 * （所以要反复补偿滚动）。改成区间替换后，文档里没有可转换内容时连一个 step 都不产生，
 * 有可转换内容时未变化的尾部节点也会原样保留。
 */
describe('源码视图转换：区间替换', () => {
  it('纯文本 / 纯行内语法文档：切换源码视图不产生任何文档变更', () => {
    const md = '# 标题\n\n带 **粗体** 与 `代码` 的段落。\n'
    const { doc } = parseMarkdown(md)

    const entered = toggleOnce(createSourceState(md, 3))
    expect(entered.docChanged).toBe(false)
    expect(entered.state.doc.eq(doc)).toBe(true)

    const exited = toggleOnce(entered.state)
    expect(exited.docChanged).toBe(false)
    expect(exited.state.doc.eq(doc)).toBe(true)
  })

  // 直接测转换函数：绕开「哨兵字符插入/删除」带来的额外 step 与位置空间位移
  it('进入源码视图：只替换可转换的块，后面的段落不参与', () => {
    const { doc } = parseMarkdown('```js\ncode\n```\n\n尾部段落\n')
    const state = EditorState.create({ doc })

    const tr = convertBlocksToParagraphs(state.tr)
    // 代码块是第 0 个块（区间 [0, nodeSize)），尾段落从它的末尾开始
    expect(stepRanges(tr)).toEqual([{ from: 0, to: doc.firstChild!.nodeSize }])
  })

  it('退出源码视图：只替换由块转换来的段落', () => {
    const { doc } = parseMarkdown('```js\ncode\n```\n\n尾部段落\n')
    const state = EditorState.create({ doc })

    // 先进入源码视图形态（代码块被拆成带 codeBlockId 的段落）
    const entered = state.apply(convertBlocksToParagraphs(state.tr))
    const tail = entered.doc.lastChild!
    const tailStart = entered.doc.content.size - tail.nodeSize

    const tr = convertParagraphsToBlocks(entered.tr)
    expect(stepRanges(tr)).toEqual([{ from: 0, to: tailStart }])
  })

  it('没有可转换内容时一个 step 都不产生', () => {
    const { doc } = parseMarkdown('# 标题\n\n普通段落\n')
    const state = EditorState.create({ doc })

    expect(stepRanges(convertBlocksToParagraphs(state.tr))).toEqual([])
    expect(stepRanges(convertParagraphsToBlocks(state.tr))).toEqual([])
  })

  it('进入源码视图后各块原文不丢', () => {
    const md = '# 标题\n\n- 列表项\n\n| a |\n| --- |\n| 1 |\n\n> 引用\n\n```js\ncode\n```\n'
    const entered = toggleOnce(createSourceState(md, 1))

    const text = entered.state.doc.textContent
    for (const fragment of ['# 标题', '- 列表项', '| a |', '| --- |', '> 引用', '```js', 'code']) {
      expect(text).toContain(fragment)
    }
  })
})

/**
 * 多实例隔离。
 *
 * 这些集合曾经是模块级单例，于是同页放两个编辑器时互相污染：A 的光标会把 A 的选区
 * 灌给 B 的公式块/HTML 块（`updateAllMathBlocks` 遍历了全局实例），A 切源码视图会让
 * B 的列表/代码块 NodeView 换样式（`sourceViewManager` 全局广播）。
 * 这里钉住「按视图分组」这条契约——NodeView 与真实 EditorView 的接线属 DOM 层，
 * 但分组与订阅语义是纯数据结构，可以在 node 环境里验证。
 */
describe('多实例隔离：按视图分组', () => {
  it('注册表只返回该视图下的实例', () => {
    const registry = createViewGroupedRegistry<string>()
    const viewA = {}
    const viewB = {}

    registry.add(viewA, 'a-1')
    registry.add(viewA, 'a-2')
    registry.add(viewB, 'b-1')

    expect([...registry.forOwner(viewA)].toSorted()).toEqual(['a-1', 'a-2'])
    expect([...registry.forOwner(viewB)]).toEqual(['b-1'])
    // 没注册过的视图拿到空集合（可直接遍历）
    expect([...registry.forOwner({})]).toEqual([])
  })

  it('摘除只影响自己的视图', () => {
    const registry = createViewGroupedRegistry<string>()
    const viewA = {}
    const viewB = {}

    registry.add(viewA, 'x')
    registry.add(viewB, 'x')
    registry.remove(viewA, 'x')

    expect([...registry.forOwner(viewA)]).toEqual([])
    expect([...registry.forOwner(viewB)]).toEqual(['x'])
  })

  it('源码视图状态不跨视图广播', () => {
    const viewA = {}
    const viewB = {}
    const seenA: boolean[] = []
    const seenB: boolean[] = []

    sourceViewRegistry.subscribe(viewA, value => seenA.push(value))
    sourceViewRegistry.subscribe(viewB, value => seenB.push(value))
    sourceViewRegistry.setState(viewA, true)

    // 订阅时立即回调一次当前值，之后只收到自己视图的变化
    expect(seenA).toEqual([false, true])
    expect(seenB).toEqual([false])
  })

  it('取消订阅后不再收到通知', () => {
    const owner = {}
    const seen: boolean[] = []
    const unsubscribe = sourceViewRegistry.subscribe(owner, value => seen.push(value))

    sourceViewRegistry.setState(owner, true)
    unsubscribe()
    sourceViewRegistry.setState(owner, false)

    expect(seen).toEqual([false, true])
  })

  it('后创建的实例立刻拿到当前状态', () => {
    const owner = {}
    sourceViewRegistry.setState(owner, true)

    const seen: boolean[] = []
    sourceViewRegistry.subscribe(owner, value => seen.push(value))

    expect(seen).toEqual([true])
  })
})

/**
 * 内核不再默认读宿主的 localStorage。
 *
 * 「从 `milkup-config` / `pasteMethod` 读配置」是宿主约定，现在收口成一个显式适配器，
 * 内核无配置时的默认是 base64（任何环境都能跑通，不写磁盘、不依赖上传服务）。
 */
describe('粘贴配置：宿主注入而非内核写死', () => {
  it('适配器读宿主存储，缺省/非法值回退 base64', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
    })

    try {
      const adapter = createLocalStoragePasteAdapter()
      expect(adapter.getImagePasteMethod?.()).toBe('base64')

      store.set('milkup-config', JSON.stringify({ image: { pasteMethod: 'remote' } }))
      expect(adapter.getImagePasteMethod?.()).toBe('remote')

      // 旧键兜底
      store.delete('milkup-config')
      store.set('pasteMethod', 'local')
      expect(adapter.getImagePasteMethod?.()).toBe('local')

      // 非法值不当真
      store.set('pasteMethod', 'whatever')
      expect(adapter.getImagePasteMethod?.()).toBe('base64')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('没有 localStorage（非浏览器环境）时不抛异常', () => {
    vi.stubGlobal('localStorage', undefined)
    try {
      expect(createLocalStoragePasteAdapter().getImagePasteMethod?.()).toBe('base64')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

/**
 * HTML 块预览的白名单清理策略。
 *
 * 之前是黑名单（危险标签 + `on*` + 少数几个 URL 属性），黑名单天然可绕过、补一个漏一个。
 * 白名单的语义是「默认不可信」：策略本身是纯函数，在 node 里就能验证；
 * DOM 遍历与摘除属浏览器行为，不在单测范围。
 */
describe('HTML 块预览的白名单清理策略', () => {
  it('危险协议：归一化空白 / 控制字符后再比对', () => {
    expect(isDangerousUrl('javascript:alert(1)')).toBe(true)
    expect(isDangerousUrl(' JaVaScRiPt:alert(1)')).toBe(true)
    // 浏览器忽略 scheme 里的空白与控制字符，`java\tscript:` 是合法的 javascript: URL
    expect(isDangerousUrl('java\tscript:alert(1)')).toBe(true)
    expect(isDangerousUrl('vbscript:x')).toBe(true)
    expect(isDangerousUrl('/relative/path.png')).toBe(false)
    expect(isDangerousUrl('https://example.com')).toBe(false)
  })

  it('data:image/* 放行（行内图片的常见写法），svg 例外', () => {
    expect(isDangerousUrl('data:image/png;base64,AAAA')).toBe(false)
    expect(isDangerousUrl('data:image/svg+xml,<svg/>')).toBe(true)
    expect(isDangerousUrl('data:text/html,<b>x</b>')).toBe(true)
  })

  it('标签策略：可执行/嵌入类整块丢弃，未知标签拆壳保内容', () => {
    for (const tag of ['script', 'style', 'iframe', 'object', 'svg', 'math', 'form', 'template']) {
      expect(classifyTag(tag)).toBe('drop')
    }
    for (const tag of ['p', 'div', 'img', 'table', 'video', 'details', 'blockquote']) {
      expect(classifyTag(tag)).toBe('keep')
    }
    expect(classifyTag('my-widget')).toBe('unwrap')
    expect(classifyTag('SCRIPT')).toBe('drop')
  })

  it('属性过滤：白名单之外一律移除，URL 属性做协议检查', () => {
    expect(
      sanitizeAttributes([
        { name: 'class', value: 'a b' },
        { name: 'onclick', value: 'alert(1)' },
        { name: 'href', value: 'javascript:alert(1)' },
        { name: 'srcdoc', value: '<script>alert(1)</script>' },
        { name: 'title', value: 't' },
      ]),
    ).toEqual([
      { name: 'class', value: 'a b' },
      { name: 'title', value: 't' },
    ])
  })

  it('target 非 _self 时强制补 noopener / noreferrer', () => {
    expect(
      sanitizeAttributes([
        { name: 'href', value: 'https://x' },
        { name: 'target', value: '_blank' },
      ]),
    ).toEqual([
      { name: 'href', value: 'https://x' },
      { name: 'target', value: '_blank' },
      { name: 'rel', value: 'noopener noreferrer' },
    ])

    // 已有 rel 只补缺失的 token，不覆盖
    expect(
      sanitizeAttributes([
        { name: 'target', value: '_blank' },
        { name: 'rel', value: 'noopener' },
      ]),
    ).toEqual([
      { name: 'target', value: '_blank' },
      { name: 'rel', value: 'noopener noreferrer' },
    ])

    expect(sanitizeAttributes([{ name: 'target', value: '_self' }])).toEqual([
      { name: 'target', value: '_self' },
    ])
  })
})
