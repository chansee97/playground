/**
 * Milkup Schema 定义
 *
 * 核心设计思路：
 * 1. 每个节点/标记都存储其 Markdown 源码标记信息
 * 2. 通过 Decoration 系统控制源码标记的显示/隐藏
 * 3. 光标实际在源码中移动，但显示为渲染后的格式
 */

import { Schema, NodeSpec, MarkSpec, DOMOutputSpec } from "prosemirror-model";

// ============ 辅助函数 ============

/** 安全的行内标签白名单 */
const SAFE_INLINE_TAGS = new Set([
  "span",
  "mark",
  "u",
  "s",
  "del",
  "ins",
  "abbr",
  "kbd",
  "var",
  "cite",
  "small",
  "ruby",
  "rp",
  "rt",
  "samp",
  "q",
  "bdi",
  "bdo",
  "data",
  "time",
  "dfn",
  "label",
  "b",
  "i",
  "em",
  "strong",
  "code",
  "sub",
  "sup",
  "a",
  "font",
]);

/**
 * 解析 HTML 属性字符串为安全的属性对象
 * 过滤 on* 事件处理器和危险 URL 协议
 */
export function parseHtmlAttrs(attrStr: string): Record<string, string> {
  if (!attrStr) return {};
  const result: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    // 过滤危险属性
    if (name.startsWith("on")) continue;
    if (
      (name === "href" || name === "src" || name === "action") &&
      /^\s*(javascript|vbscript|data)\s*:/i.test(value)
    )
      continue;
    result[name] = value;
  }
  return result;
}

// ============ 节点定义 ============

const doc: NodeSpec = {
  content: "block+",
};

const paragraph: NodeSpec = {
  attrs: {
    // 代码块相关属性（仅在源码模式下使用）
    codeBlockId: { default: null },
    lineIndex: { default: null },
    totalLines: { default: null },
    language: { default: null },
    // 分割线相关属性（仅在源码模式下使用）
    hrSource: { default: null },
    // 表格相关属性（仅在源码模式下使用）
    tableId: { default: null },
    tableRowIndex: { default: null },
    tableTotalRows: { default: null },
    // HTML 块相关属性（仅在源码模式下使用）
    htmlBlockId: { default: null },
    htmlBlockLineIndex: { default: null },
    htmlBlockTotalLines: { default: null },
    // 数学公式块相关属性（仅在源码模式下使用）
    mathBlockId: { default: null },
    mathBlockLineIndex: { default: null },
    mathBlockTotalLines: { default: null },
    // 列表相关属性（仅在源码模式下使用）
    listId: { default: null },
    listLineIndex: { default: null },
    listTotalLines: { default: null },
    // 引用块相关属性（仅在源码模式下使用）
    blockquoteId: { default: null },
    blockquoteLineIndex: { default: null },
    blockquoteTotalLines: { default: null },
    blockquoteSeparator: { default: null },
  },
  content: "inline*",
  group: "block",
  parseDOM: [{ tag: "p" }],
  toDOM(node): DOMOutputSpec {
    const attrs: Record<string, any> = {};
    // 如果是代码块段落，添加数据属性
    if (node.attrs.codeBlockId) {
      attrs["data-code-block-id"] = node.attrs.codeBlockId;
      attrs["data-line-index"] = node.attrs.lineIndex;
      attrs["data-total-lines"] = node.attrs.totalLines;
      attrs["data-language"] = node.attrs.language;
    }
    // 如果是分割线段落，添加数据属性
    if (node.attrs.hrSource) {
      attrs["data-hr-source"] = "true";
    }
    // 如果是表格段落，添加数据属性
    if (node.attrs.tableId) {
      attrs["data-table-id"] = node.attrs.tableId;
      attrs["data-table-row-index"] = node.attrs.tableRowIndex;
      attrs["data-table-total-rows"] = node.attrs.tableTotalRows;
    }
    // 如果是 HTML 块段落，添加数据属性
    if (node.attrs.htmlBlockId) {
      attrs["data-html-block-id"] = node.attrs.htmlBlockId;
      attrs["data-html-block-line-index"] = node.attrs.htmlBlockLineIndex;
      attrs["data-html-block-total-lines"] = node.attrs.htmlBlockTotalLines;
    }
    // 如果是数学公式块段落，添加数据属性
    if (node.attrs.mathBlockId) {
      attrs["data-math-block-id"] = node.attrs.mathBlockId;
      attrs["data-math-block-line-index"] = node.attrs.mathBlockLineIndex;
      attrs["data-math-block-total-lines"] = node.attrs.mathBlockTotalLines;
    }
    // 如果是列表段落，添加数据属性
    if (node.attrs.listId) {
      attrs["data-list-id"] = node.attrs.listId;
      attrs["data-list-line-index"] = node.attrs.listLineIndex;
      attrs["data-list-total-lines"] = node.attrs.listTotalLines;
    }
    // 如果是引用块段落，添加数据属性
    if (node.attrs.blockquoteId) {
      attrs["data-blockquote-id"] = node.attrs.blockquoteId;
      attrs["data-blockquote-line-index"] = node.attrs.blockquoteLineIndex;
      attrs["data-blockquote-total-lines"] = node.attrs.blockquoteTotalLines;
    }
    if (node.attrs.blockquoteSeparator) {
      attrs["data-blockquote-separator"] = "true";
    }
    return ["p", attrs, 0];
  },
};

const heading: NodeSpec = {
  attrs: {
    level: { default: 1 },
  },
  content: "inline*",
  group: "block",
  defining: true,
  parseDOM: [
    { tag: "h1", attrs: { level: 1 } },
    { tag: "h2", attrs: { level: 2 } },
    { tag: "h3", attrs: { level: 3 } },
    { tag: "h4", attrs: { level: 4 } },
    { tag: "h5", attrs: { level: 5 } },
    { tag: "h6", attrs: { level: 6 } },
  ],
  toDOM(node): DOMOutputSpec {
    return [`h${node.attrs.level}`, 0];
  },
};

const blockquote: NodeSpec = {
  attrs: {
    alertType: { default: null },
  },
  content: "block+",
  group: "block",
  defining: true,
  parseDOM: [
    {
      tag: "blockquote",
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          alertType: el.getAttribute("data-alert-type") || null,
        };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    const attrs: Record<string, string> = {};
    if (node.attrs.alertType) {
      attrs.class = `blockquote-alert blockquote-alert-${node.attrs.alertType}`;
      attrs["data-alert-type"] = node.attrs.alertType;
    }
    return ["blockquote", attrs, 0];
  },
};

const code_block: NodeSpec = {
  attrs: {
    language: { default: "" },
    /* 原文的围栏形态，保证往返不失真：```  vs ~~~、围栏长度、info string */
    fence: { default: "```" },
    meta: { default: "" },
    /* 缩进式代码块（4 空格），序列化时按 4 空格还原而不是转成围栏 */
    indented: { default: false },
  },
  content: "text*",
  marks: "",
  group: "block",
  code: true,
  defining: true,
  parseDOM: [
    {
      tag: "pre",
      preserveWhitespace: "full" as const,
      getAttrs(node) {
        const el = node as HTMLElement;
        const code = el.querySelector("code");
        const className = code?.className || "";
        const match = className.match(/language-(\w+)/);
        return { language: match ? match[1] : "" };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    return [
      "pre",
      ["code", { class: node.attrs.language ? `language-${node.attrs.language}` : "" }, 0],
    ];
  },
};

const frontmatter: NodeSpec = {
  attrs: {
    kind: { default: "yaml" },
  },
  content: "text*",
  marks: "",
  group: "block",
  code: true,
  defining: true,
  parseDOM: [{ tag: "div.frontmatter", preserveWhitespace: "full" as const }],
  toDOM(node): DOMOutputSpec {
    return ["div", { class: `frontmatter frontmatter-${node.attrs.kind}` }, ["pre", 0]];
  },
};

const horizontal_rule: NodeSpec = {
  attrs: {
    /* 原文的分隔线写法（`---` / `***` / `_ _ _`），保证往返不失真 */
    marker: { default: "---" },
  },
  group: "block",
  parseDOM: [{ tag: "hr" }],
  toDOM(): DOMOutputSpec {
    return ["hr"];
  },
};

const bullet_list: NodeSpec = {
  attrs: {
    /* 原文使用的列表符号（`-` / `*` / `+`） */
    marker: { default: "-" },
    /* 松散列表（项之间有空行），GFM 下会影响渲染 */
    spread: { default: false },
  },
  content: "list_item+",
  group: "block",
  parseDOM: [{ tag: "ul" }],
  toDOM(): DOMOutputSpec {
    return ["ul", 0];
  },
};

const ordered_list: NodeSpec = {
  attrs: {
    start: { default: 1 },
    /* 序号分隔符：1. 还是 1) */
    delimiter: { default: "." },
    spread: { default: false },
  },
  content: "list_item+",
  group: "block",
  parseDOM: [
    {
      tag: "ol",
      getAttrs(node) {
        const el = node as HTMLElement;
        return { start: el.hasAttribute("start") ? Number(el.getAttribute("start")) : 1 };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    return node.attrs.start === 1 ? ["ol", 0] : ["ol", { start: node.attrs.start }, 0];
  },
};

const list_item: NodeSpec = {
  content: "block+",
  parseDOM: [{ tag: "li" }],
  toDOM(): DOMOutputSpec {
    return ["li", 0];
  },
  defining: true,
};

const task_list: NodeSpec = {
  attrs: {
    /* 与普通列表一致：项之间有空行时为松散列表 */
    spread: { default: false },
  },
  content: "task_item+",
  group: "block",
  parseDOM: [{ tag: "ul.task-list" }],
  toDOM(): DOMOutputSpec {
    return ["ul", { class: "task-list" }, 0];
  },
};

const task_item: NodeSpec = {
  attrs: {
    checked: { default: false },
  },
  content: "block+",
  parseDOM: [
    {
      tag: "li.task-item",
      getAttrs(node) {
        const el = node as HTMLElement;
        const checkbox = el.querySelector('input[type="checkbox"]');
        return { checked: checkbox ? (checkbox as HTMLInputElement).checked : false };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    return [
      "li",
      { class: "task-item" },
      ["input", { type: "checkbox", checked: node.attrs.checked ? "checked" : null }],
      ["span", 0],
    ];
  },
  defining: true,
};

const table: NodeSpec = {
  content: "table_row+",
  group: "block",
  tableRole: "table",
  isolating: true,
  parseDOM: [{ tag: "table" }],
  toDOM(): DOMOutputSpec {
    return ["table", ["tbody", 0]];
  },
};

const table_row: NodeSpec = {
  content: "(table_cell | table_header)+",
  tableRole: "row",
  parseDOM: [{ tag: "tr" }],
  toDOM(): DOMOutputSpec {
    return ["tr", 0];
  },
};

const table_cell: NodeSpec = {
  content: "inline*",
  attrs: {
    colspan: { default: 1 },
    rowspan: { default: 1 },
    align: { default: null },
  },
  tableRole: "cell",
  isolating: true,
  parseDOM: [
    {
      tag: "td",
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          colspan: Number(el.getAttribute("colspan")) || 1,
          rowspan: Number(el.getAttribute("rowspan")) || 1,
          align: el.style.textAlign || null,
        };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    const attrs: Record<string, any> = {};
    if (node.attrs.colspan !== 1) attrs.colspan = node.attrs.colspan;
    if (node.attrs.rowspan !== 1) attrs.rowspan = node.attrs.rowspan;
    if (node.attrs.align) attrs.style = `text-align: ${node.attrs.align}`;
    return ["td", attrs, 0];
  },
};

const table_header: NodeSpec = {
  content: "inline*",
  attrs: {
    colspan: { default: 1 },
    rowspan: { default: 1 },
    align: { default: null },
  },
  tableRole: "header_cell",
  isolating: true,
  parseDOM: [
    {
      tag: "th",
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          colspan: Number(el.getAttribute("colspan")) || 1,
          rowspan: Number(el.getAttribute("rowspan")) || 1,
          align: el.style.textAlign || null,
        };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    const attrs: Record<string, any> = {};
    if (node.attrs.colspan !== 1) attrs.colspan = node.attrs.colspan;
    if (node.attrs.rowspan !== 1) attrs.rowspan = node.attrs.rowspan;
    if (node.attrs.align) attrs.style = `text-align: ${node.attrs.align}`;
    return ["th", attrs, 0];
  },
};

const math_block: NodeSpec = {
  attrs: {
    language: { default: "latex" },
  },
  content: "text*",
  marks: "",
  group: "block",
  code: true,
  defining: true,
  parseDOM: [
    {
      tag: "div.math-block",
      preserveWhitespace: "full" as const,
    },
  ],
  toDOM(): DOMOutputSpec {
    return ["div", { class: "math-block" }, ["pre", 0]];
  },
};

const html_block: NodeSpec = {
  content: "text*",
  marks: "",
  group: "block",
  code: true,
  defining: true,
  parseDOM: [{ tag: "div.html-block", preserveWhitespace: "full" as const }],
  toDOM(): DOMOutputSpec {
    return ["div", { class: "html-block" }, ["pre", 0]];
  },
};

/*
 * 引用式链接 / 脚注的「定义块」：`[a]: http://x`、`[^1]: note`。
 *
 * 定义是元数据而不是渲染内容：正文里的引用点由 mark 呈现（link / footnote_ref），
 * 定义本身不产生可见输出。但它是用户可编辑的原文的一部分，必须留在文档里
 * （否则每次编辑都会丢掉定义），因此承载为一个整段原样的文本块，保证逐字节往返。
 */
const link_definition: NodeSpec = {
  attrs: {
    /* link = 引用式链接定义；footnote = 脚注定义 */
    kind: { default: "link" },
  },
  content: "text*",
  marks: "",
  group: "block",
  code: true,
  defining: true,
  parseDOM: [
    {
      tag: "div.milkup-link-definition",
      preserveWhitespace: "full" as const,
      getAttrs(node) {
        return { kind: (node as HTMLElement).getAttribute("data-kind") || "link" };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    return [
      "div",
      { class: "milkup-link-definition", "data-kind": node.attrs.kind },
      ["pre", 0],
    ];
  },
};

/*
 * 图片是行内「mark + 真实文本」：整段 `![alt](src "title")`（链接图片则含外层
 * `[..](href)`）作为文本保存在文档里，mark 上带着解析出的属性供渲染。
 *
 * 这样光标可以像其它行内语法一样进入语法内部逐字移动、前后退出；
 * 显示原文还是渲染成图由装饰层按光标位置决定（见 decorations）。
 */
const image: MarkSpec = {
  attrs: {
    src: { default: "" },
    alt: { default: "" },
    title: { default: "" },
    /* 链接图片 `[![alt](src)](href)` 的外层链接 */
    linkHref: { default: "" },
    linkTitle: { default: "" },
  },
  inclusive: false, // 在语法末尾继续输入不继承此 mark
  toDOM(mark): DOMOutputSpec {
    return ["span", { class: "milkup-image-mark", "data-src": mark.attrs.src }, 0];
  },
};

const text: NodeSpec = {
  group: "inline",
};

const hard_break: NodeSpec = {
  attrs: {
    /* 原文写法：行尾两空格 `  \n` 或反斜杠 `\\\n` */
    raw: { default: "  \n" },
  },
  inline: true,
  group: "inline",
  selectable: false,
  parseDOM: [{ tag: "br" }],
  toDOM(): DOMOutputSpec {
    return ["br"];
  },
};

// ============ 标记定义 ============

const strong: MarkSpec = {
  inclusive: false, // 新输入的文本不自动继承此 mark
  parseDOM: [
    { tag: "strong" },
    { tag: "b", getAttrs: (node) => (node as HTMLElement).style.fontWeight !== "normal" && null },
    {
      style: "font-weight",
      getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null,
    },
  ],
  toDOM(): DOMOutputSpec {
    return ["strong", 0];
  },
};

const emphasis: MarkSpec = {
  inclusive: false, // 新输入的文本不自动继承此 mark
  parseDOM: [
    { tag: "em" },
    { tag: "i", getAttrs: (node) => (node as HTMLElement).style.fontStyle !== "normal" && null },
    { style: "font-style=italic" },
  ],
  toDOM(): DOMOutputSpec {
    return ["em", 0];
  },
};

const code_inline: MarkSpec = {
  inclusive: false, // 新输入的文本不自动继承此 mark
  parseDOM: [{ tag: "code" }],
  toDOM(): DOMOutputSpec {
    return ["code", { class: "milkup-code-inline" }, 0];
  },
};

const strikethrough: MarkSpec = {
  inclusive: false, // 新输入的文本不自动继承此 mark
  parseDOM: [
    { tag: "s" },
    { tag: "del" },
    { tag: "strike" },
    {
      style: "text-decoration",
      getAttrs: (value) => (value as string).includes("line-through") && null,
    },
  ],
  toDOM(): DOMOutputSpec {
    return ["del", 0];
  },
};

const link: MarkSpec = {
  attrs: {
    href: { default: "" },
    title: { default: "" },
  },
  inclusive: false,
  parseDOM: [
    {
      tag: "a[href]",
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          href: el.getAttribute("href") || "",
          title: el.getAttribute("title") || "",
        };
      },
    },
  ],
  toDOM(mark): DOMOutputSpec {
    return ["a", { href: mark.attrs.href, title: mark.attrs.title || null }, 0];
  },
};

const highlight: MarkSpec = {
  inclusive: false, // 新输入的文本不自动继承此 mark
  parseDOM: [
    { tag: "mark" },
    { style: "background-color", getAttrs: (value) => (value as string) !== "transparent" && null },
  ],
  toDOM(): DOMOutputSpec {
    return ["mark", 0];
  },
};

const math_inline: MarkSpec = {
  attrs: {
    content: { default: "" },
  },
  parseDOM: [
    {
      tag: "span.math-inline",
      getAttrs(node) {
        const el = node as HTMLElement;
        return { content: el.getAttribute("data-content") || "" };
      },
    },
  ],
  toDOM(mark): DOMOutputSpec {
    return ["span", { class: "math-inline", "data-content": mark.attrs.content }, 0];
  },
};

const sub: MarkSpec = {
  inclusive: false,
  parseDOM: [{ tag: "sub" }],
  toDOM(): DOMOutputSpec {
    return ["sub", 0];
  },
};

const sup: MarkSpec = {
  inclusive: false,
  parseDOM: [{ tag: "sup" }],
  toDOM(): DOMOutputSpec {
    return ["sup", 0];
  },
};

const html_inline: MarkSpec = {
  attrs: {
    tag: { default: "span" },
    htmlAttrs: { default: "" }, // 原始属性字符串，如 'style="color:red" class="foo"'
  },
  inclusive: false,
  excludes: "", // 可以与其他 mark 共存
  toDOM(mark): DOMOutputSpec {
    const tag = mark.attrs.tag || "span";
    const safeTag = SAFE_INLINE_TAGS.has(tag) ? tag : "span";
    const attrs = parseHtmlAttrs(mark.attrs.htmlAttrs);
    return [safeTag, attrs, 0];
  },
};

const footnote_ref: MarkSpec = {
  attrs: {
    id: { default: "" },
  },
  parseDOM: [
    {
      tag: "sup.footnote-ref",
      getAttrs(node) {
        const el = node as HTMLElement;
        return { id: el.getAttribute("data-id") || "" };
      },
    },
  ],
  toDOM(mark): DOMOutputSpec {
    return ["sup", { class: "footnote-ref", "data-id": mark.attrs.id }, 0];
  },
};

/**
 * 语法标记 Mark
 * 用于标记 Markdown 语法符号（如 **, *, ~~, ` 等）
 * 这些文本是真实存在于文档中的，可以被光标选中
 */
const syntax_marker: MarkSpec = {
  attrs: {
    syntaxType: { default: "" }, // 语法类型：strong, emphasis, code_inline 等
  },
  excludes: "", // 可以与其他 mark 共存
  inclusive: false, // 新输入的文本不继承此 mark，防止无法逃出语法区域
  parseDOM: [
    {
      tag: "span.milkup-syntax",
      getAttrs(node) {
        const el = node as HTMLElement;
        return { syntaxType: el.getAttribute("data-syntax-type") || "" };
      },
    },
  ],
  toDOM(mark): DOMOutputSpec {
    return [
      "span",
      {
        class: "milkup-syntax",
        "data-syntax-type": mark.attrs.syntaxType,
      },
      0,
    ];
  },
};

// ============ Schema 导出 ============

export const milkupSchema = new Schema({
  nodes: {
    doc,
    paragraph,
    heading,
    blockquote,
    code_block,
    horizontal_rule,
    bullet_list,
    ordered_list,
    list_item,
    task_list,
    task_item,
    table,
    table_row,
    table_cell,
    table_header,
    math_block,
    html_block,
    link_definition,
    frontmatter,
    text,
    hard_break,
  },
  marks: {
    // 语法标记 mark 放在最前面，优先级最高
    syntax_marker,
    strong,
    emphasis,
    code_inline,
    strikethrough,
    link,
    highlight,
    math_inline,
    image,
    sub,
    sup,
    html_inline,
    footnote_ref,
  },
});

export type MilkupSchema = typeof milkupSchema;
