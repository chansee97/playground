/**
 * Markdown 解析器：**mdast 判定结构 + 源码 offset 切分标记**
 *
 * ## 为什么这样做
 *
 * 内核的架构是「Markdown 标记即文档里的真实文本」，光标可以在 `**` 之间自由移动。
 * 这决定了不能直接使用 remark/markdown-it 产出的 AST 内容（它们把标记丢掉了），
 * 但也**不应该**自己手写正则去猜结构 —— 早期版本正是因此产生了大量规范偏差
 * （`* * *` 被解析成嵌套列表、`    x` 不是代码块、setext 标题被当成段落…）。
 *
 * 所以这里分工：
 *   - **结构判定**交给 remark（CommonMark + GFM + math，由 micromark 驱动）
 *   - **标记文本**由本文件按 AST 的 `position.offset` 从原始源码里切出来
 *
 * ## 核心不变量
 *
 * 1. 每个节点/标记都带绝对 offset，因此可以「永远不回退到 AST 的 value，
 *    只用 `source.slice(start, end)`」。这样转义 `\*`、实体 `&copy;`、多反引号
 *    代码段 `` ``a`b`` `` 都能原样保留 —— AST 会把它们解码成 `*` / `©` / `a`b`。
 * 2. 相邻节点之间的「非节点区间」就是定界符（gap）。walk 时把 gap 也输出成文本，
 *    未识别的标点不会凭空消失。
 */
import type {
  Blockquote,
  Code,
  Heading,
  Html,
  Image,
  LinkReference,
  List,
  ListItem,
  Nodes,
  Paragraph,
  Parent,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
} from "mdast";
import { Node, Schema, Mark } from "prosemirror-model";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { milkupSchema } from "../schema";
import type { SyntaxMarker } from "../types";
import { HTML_ENTITY_SYNTAX_TYPE, matchHtmlEntityAt } from "../utils/html-entities";

/** 解析结果 */
export interface ParseResult {
  doc: Node;
  markers: SyntaxMarker[];
}

/** CommonMark 可转义字符集：全部 ASCII 标点 */
const ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

/** 引用块行首前缀（允许最多 3 个缩进空格） */
const BLOCKQUOTE_PREFIX = /^[ \t]{0,3}>[ \t]?/;

/** GitHub 告示块标记 */
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*/i;

/** 行内换行标签 → 硬换行 */
const BR_TAG = /^<br\s*\/?>$/i;

/** 自闭合 / 空元素，无法与后面配对 */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img",
  "input", "link", "meta", "param", "source", "track", "wbr",
]);

/** 行首需要被剥离的规则 */
interface LinePrefixRule {
  re: RegExp;
  /** 有值则把被剥离的文本输出为语法标记；否则直接丢弃（如列表续行缩进） */
  syntaxType?: string;
  /** 最多消费多少个字符 */
  limit?: number;
}

/** 引用式链接定义（`[a]: http://x "title"`）解析出的目标 */
interface LinkDefinition {
  url: string;
  title: string;
}

/** 解析上下文 */
interface Ctx {
  /** 当前正在切分的源码（容器/段落各自独立，offset 相对它自己） */
  src: string;
  /** 行首规则（引用块 `>`、列表续行缩进…），按外层到内层叠加 */
  prefixes: LinePrefixRule[];
  /** 继承的 mark */
  marks: Mark[];
  /** true 表示内容字面保留（代码段 / 公式内不处理转义与实体） */
  literal?: boolean;
  /** 段首/段尾 gap 若是标记，用这个语法类型输出 */
  gapSyntaxType?: string;
  /** 段落开头需要单独切出的标记（告示块 `[!NOTE]`），用后即清 */
  headMarker?: string | null;
  /** 文档级引用式链接定义：标签 → 目标，供 `linkReference` 解析 */
  definitions?: Map<string, LinkDefinition>;
}

/**
 * 链接定义标签的规范化：CommonMark 规定匹配时大小写不敏感、连续空白折叠成一个空格。
 */
function normalizeIdentifier(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 递归收集文档里全部引用式链接定义（`[a]: http://x`，含嵌套在容器里的） */
function collectLinkDefinitions(
  nodes: RootContent[],
  into: Map<string, LinkDefinition>
): void {
  for (const child of nodes) {
    if (child.type === "definition") {
      into.set(normalizeIdentifier(child.identifier), {
        url: child.url,
        title: child.title ?? "",
      });
    }
    if ("children" in child && Array.isArray(child.children)) {
      collectLinkDefinitions(child.children as RootContent[], into);
    }
  }
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

function lineStartOf(src: string, offset: number): number {
  const nl = src.lastIndexOf("\n", offset - 1);
  return nl === -1 ? 0 : nl + 1;
}

/** 切出文档最开头的 YAML front matter；用「必须含冒号」避免把 `---` 分割线误判 */
function splitFrontmatter(src: string): { kind: string; value: string; rest: string } | null {
  const match = /^---[ \t]*\n([\s\S]*?)\n?---[ \t]*(?:\n|$)/.exec(src);
  if (!match || !match[1].includes(":")) return null;
  return { kind: "yaml", value: match[1], rest: src.slice(match[0].length) };
}

/**
 * Markdown 解析器
 */
export class MarkdownParser {
  private schema: Schema;

  constructor(schema: Schema = milkupSchema) {
    this.schema = schema;
  }

  parse(markdown: string): ParseResult {
    const source = markdown.replace(/\r\n?/g, "\n");
    const blocks: Node[] = [];

    const frontmatter = splitFrontmatter(source);
    if (frontmatter) {
      blocks.push(
        this.schema.node(
          "frontmatter",
          { kind: frontmatter.kind },
          frontmatter.value ? [this.schema.text(frontmatter.value)] : []
        )
      );
    }

    const body = frontmatter ? frontmatter.rest : source;
    const tree = processor.parse(body) as Root;
    const definitions = new Map<string, LinkDefinition>();
    collectLinkDefinitions(tree.children, definitions);
    blocks.push(
      ...this.blocks(tree.children, { src: body, prefixes: [], marks: [], definitions })
    );

    const doc = this.schema.node(
      "doc",
      null,
      blocks.length ? blocks : [this.schema.node("paragraph")]
    );
    return { doc, markers: [] };
  }

  // ============ 块级 ============

  private slice(node: Nodes, src: string): string {
    const pos = node.position;
    if (!pos) return "";
    return src.slice(pos.start.offset ?? 0, pos.end.offset ?? 0);
  }

  private blocks(children: RootContent[], ctx: Ctx): Node[] {
    const out: Node[] = [];
    for (const child of children) out.push(...this.block(child, ctx));
    return out;
  }

  private block(node: RootContent, ctx: Ctx): Node[] {
    const schema = this.schema;

    switch (node.type) {
      case "paragraph": {
        return [schema.node("paragraph", null, this.inline(node as Paragraph, ctx))];
      }

      case "heading": {
        const heading = node as Heading;
        return [
          schema.node(
            "heading",
            { level: heading.depth },
            this.inline(heading, { ...ctx, gapSyntaxType: "heading" })
          ),
        ];
      }

      case "blockquote": {
        const quote = node as Blockquote;
        const alert = this.detectAlert(quote, ctx);
        const inner = this.blocks(quote.children, {
          ...ctx,
          prefixes: [
            ...ctx.prefixes,
            { re: BLOCKQUOTE_PREFIX, syntaxType: "blockquote" },
          ],
          gapSyntaxType: "blockquote",
          headMarker: alert?.marker ?? null,
        });
        return [
          schema.node(
            "blockquote",
            alert ? { alertType: alert.type } : null,
            inner.length ? inner : [schema.node("paragraph")]
          ),
        ];
      }

      case "list":
        return [this.list(node as List, ctx)];

      case "code": {
        const code = node as Code;
        const raw = this.slice(code, ctx.src);
        const fence = /^[ \t]*(`{3,}|~{3,})/.exec(raw);
        const content = code.value ? [schema.text(code.value)] : [];
        if (fence) {
          return [
            schema.node(
              "code_block",
              { language: code.lang ?? "", meta: code.meta ?? "", fence: fence[1], indented: false },
              content
            ),
          ];
        }
        return [schema.node("code_block", { language: "", indented: true }, content)];
      }

      case "html":
        return [
          schema.node("html_block", null, [
            schema.text(this.slice(node as Html, ctx.src)),
          ]),
        ];

      case "thematicBreak": {
        const marker = this.slice(node, ctx.src).trim() || "---";
        return [schema.node("horizontal_rule", { marker })];
      }

      case "table":
        return [this.table(node as Table, ctx)];

      case "math": {
        const value = (node as { value?: string }).value ?? "";
        return [schema.node("math_block", null, value ? [schema.text(value)] : [])];
      }

      // 引用式链接定义 / 脚注定义：原文整段保留（不渲染），供引用点解析与往返使用
      case "definition":
      case "footnoteDefinition": {
        const raw = this.slice(node, ctx.src);
        return [
          schema.node(
            "link_definition",
            { kind: node.type === "footnoteDefinition" ? "footnote" : "link" },
            raw ? [schema.text(raw)] : []
          ),
        ];
      }

      default: {
        // 未支持的块：原样保留为文本段落，避免丢数据
        const raw = this.slice(node, ctx.src);
        if (!raw) return [];
        return [schema.node("paragraph", null, this.scan(raw, { ...ctx, literal: true }))];
      }
    }
  }

  /** 检测 GitHub 告示块 */
  private detectAlert(quote: Blockquote, ctx: Ctx): { type: string; marker: string } | null {
    const first = quote.children[0];
    if (!first || first.type !== "paragraph") return null;
    const match = ALERT_MARKER.exec(this.slice(first, ctx.src));
    if (!match) return null;
    return { type: match[1].toLowerCase(), marker: match[0] };
  }

  private list(list: List, ctx: Ctx): Node {
    const schema = this.schema;
    const src = ctx.src;
    const firstItem = list.children[0];
    const itemGap = firstItem
      ? src.slice(firstItem.position?.start.offset ?? 0, this.firstContentOffset(firstItem))
      : "";

    const taskList = list.children.some(
      (item) => (item as ListItem).checked !== null && (item as ListItem).checked !== undefined
    );

    const items = list.children.map((item) =>
      this.listItem(item as ListItem, ctx, taskList)
    );

    if (list.ordered) {
      const delimiter = /^\s*\d+([.)])/.exec(itemGap)?.[1] ?? ".";
      return schema.node(
        "ordered_list",
        { start: list.start ?? 1, delimiter, spread: Boolean(list.spread) },
        items
      );
    }
    if (taskList) {
      return schema.node("task_list", { spread: Boolean(list.spread) }, items);
    }
    const marker = /^\s*([-*+])/.exec(itemGap)?.[1] ?? "-";
    return schema.node("bullet_list", { marker, spread: Boolean(list.spread) }, items);
  }

  private firstContentOffset(item: ListItem): number {
    const first = item.children[0];
    return first?.position?.start.offset ?? item.position?.start.offset ?? 0;
  }

  private listItem(item: ListItem, ctx: Ctx, taskList: boolean): Node {
    const schema = this.schema;
    const src = ctx.src;
    const itemStart = item.position?.start.offset ?? 0;
    const contentStart = this.firstContentOffset(item);
    // 列表项续行需要剥离的缩进量（内容列 - 行首列）
    const indent = contentStart - lineStartOf(src, itemStart);

    const children = this.blocks(item.children, {
      ...ctx,
      prefixes: [...ctx.prefixes, { re: /^[ \t]+/, limit: indent }],
    });
    const content = children.length ? children : [schema.node("paragraph")];

    if (!taskList) return schema.node("list_item", null, content);
    return schema.node("task_item", { checked: Boolean(item.checked) }, content);
  }

  private table(table: Table, ctx: Ctx): Node {
    const schema = this.schema;
    const rows = table.children.map((row, rowIndex) =>
      schema.node(
        "table_row",
        null,
        row.children.map((cell, cellIndex) => {
          const align = table.align?.[cellIndex] ?? null;
          const type = rowIndex === 0 ? "table_header" : "table_cell";
          return schema.node(
            type,
            align ? { align } : null,
            this.cellInline(cell as TableCell, ctx)
          );
        })
      )
    );
    return schema.node("table", null, rows);
  }

  /** 表格单元格：只取子节点覆盖的区间，避免把两侧的 `|` 当成内容 */
  private cellInline(cell: TableCell, ctx: Ctx): Node[] {
    const kids = cell.children;
    if (kids.length === 0) return [];
    const from = kids[0].position?.start.offset ?? 0;
    const to = kids[kids.length - 1].position?.end.offset ?? from;
    return this.emit(kids, ctx, [from, to]);
  }

  // ============ 行内 ============

  private inline(parent: Parent, ctx: Ctx): Node[] {
    const pos = parent.position;
    const from = pos?.start.offset ?? 0;
    const to = pos?.end.offset ?? from;
    return this.emit(parent.children as PhrasingContent[], ctx, [from, to]);
  }

  /**
   * 按 [range] 输出一段行内内容。
   * 节点之间的空档（gap）就是定界符本身，一并输出。
   */
  private emit(
    kids: PhrasingContent[],
    ctx: Ctx,
    range: [number, number],
    fromIndex = 0,
    toIndex = kids.length - 1
  ): Node[] {
    const out: Node[] = [];
    let cursor = range[0];

    for (let i = fromIndex; i <= toIndex; i++) {
      const kid = kids[i];
      const kidFrom = kid.position?.start.offset ?? cursor;
      const kidTo = kid.position?.end.offset ?? kidFrom;

      if (kidFrom > cursor) out.push(...this.gap(ctx.src.slice(cursor, kidFrom), cursor, ctx));

      if (kid.type === "html") {
        const paired = this.htmlPair(kids, i, toIndex, ctx);
        if (paired) {
          out.push(...paired.nodes);
          cursor = paired.end;
          i = paired.next;
          continue;
        }
      }

      out.push(...this.inlineNode(kid, ctx));
      cursor = kidTo;
    }

    if (cursor < range[1]) out.push(...this.gap(ctx.src.slice(cursor, range[1]), cursor, ctx));
    return out;
  }

  private inlineNode(node: PhrasingContent, ctx: Ctx): Node[] {
    const schema = this.schema;

    switch (node.type) {
      case "text":
        return this.text(
          this.slice(node, ctx.src),
          node.position?.start.offset ?? 0,
          ctx
        );

      case "strong":
        return this.wrapped("strong", node, ctx);

      case "emphasis":
        return this.wrapped("emphasis", node, ctx);

      case "delete":
        return this.wrapped("strikethrough", node, ctx);

      case "inlineCode":
        return this.delimited("code_inline", node, ctx, { literal: true });

      case "inlineMath":
        return this.delimited("math_inline", node, ctx, {
          literal: true,
          attrs: { content: node.value },
        });

      case "link": {
        // 链接图片 [![alt](src)](href)：整段语法作为文本 + image mark
        if (node.children.length === 1 && node.children[0].type === "image") {
          const raw = this.slice(node, ctx.src);
          const mark = this.schema.marks.image.create({
            src: (node.children[0] as Image).url ?? "",
            alt: (node.children[0] as Image).alt ?? "",
            title: (node.children[0] as Image).title ?? "",
            linkHref: node.url ?? "",
            linkTitle: node.title ?? "",
          });
          return [this.schema.text(raw, [...ctx.marks, mark])];
        }
        return this.wrapped("link", node, ctx, { href: node.url, title: node.title ?? "" });
      }

      // 引用式链接 `[a]` / `[a][b]`：用定义表里的目标套上普通 link mark。
      // 语法文本仍是真实文本（`[` … `]`），只是引用点渲染成链接。
      case "linkReference": {
        const definition = ctx.definitions?.get(normalizeIdentifier(node.identifier));
        if (!definition) {
          const raw = this.slice(node, ctx.src);
          if (!raw) return [];
          return this.text(raw, node.position?.start.offset ?? 0, ctx);
        }
        return this.wrapped("link", node as LinkReference & Parent, ctx, {
          href: definition.url,
          title: definition.title,
        });
      }

      // GFM 脚注引用 `[^1]`：`[^` 与 `]` 是语法标记，正文 `1` 带 footnote_ref mark
      case "footnoteReference": {
        const raw = this.slice(node, ctx.src);
        const id = /^\[\^([\s\S]*)\]$/.exec(raw)?.[1] ?? node.identifier;
        const mark = this.schema.marks.footnote_ref.create({ id });
        const edgeMarks = [...ctx.marks, this.syntaxMark("footnote_ref")];
        const out: Node[] = [this.schema.text("[^", edgeMarks)];
        if (id) out.push(this.schema.text(id, [...ctx.marks, mark]));
        out.push(this.schema.text("]", edgeMarks));
        return out;
      }

      case "image": {
        // 图片语法即真实文本：整段 `![alt](src "title")` + image mark，
        // 显示原文还是渲染成图由装饰层按光标位置决定
        const raw = this.slice(node, ctx.src);
        const mark = this.schema.marks.image.create({
          src: (node as Image).url ?? "",
          alt: (node as Image).alt ?? "",
          title: (node as Image).title ?? "",
        });
        return [this.schema.text(raw, [...ctx.marks, mark])];
      }

      case "break": {
        const raw = this.slice(node, ctx.src) || "  \n";
        return [schema.node("hard_break", { raw })];
      }

      case "html": {
        const raw = this.slice(node, ctx.src);
        if (BR_TAG.test(raw)) return [schema.node("hard_break", { raw: "  \n" })];
        // 未配对的标签：保持可见的原样文本，不隐藏
        return [schema.text(raw, ctx.marks)];
      }

      default: {
        // 引用式链接、脚注引用等尚未建模：原样保留文本，避免丢内容
        const raw = this.slice(node, ctx.src);
        if (!raw) return [];
        return this.text(raw, node.position?.start.offset ?? 0, ctx);
      }
    }
  }

  /** 成对定界符的 mark（**a** / *a* / ~~a~~ / [a](u)） */
  private wrapped(
    markName: string,
    node: PhrasingContent & Parent,
    ctx: Ctx,
    attrs: Record<string, unknown> = {}
  ): Node[] {
    const pos = node.position;
    const from = pos?.start.offset ?? 0;
    const to = pos?.end.offset ?? from;
    const kids = node.children;
    const first = kids[0];
    const last = kids[kids.length - 1];

    const prefixEnd = first?.position?.start.offset ?? from;
    const suffixStart = last?.position?.end.offset ?? to;
    const mark = this.schema.marks[markName]?.create(attrs);

    const out: Node[] = [];
    const prefix = ctx.src.slice(from, prefixEnd);
    const suffix = ctx.src.slice(suffixStart, to);
    const edgeMarks = mark ? [...ctx.marks, this.syntaxMark(markName), mark] : ctx.marks;
    const innerMarks = mark ? [...ctx.marks, mark] : ctx.marks;

    if (prefix) out.push(this.schema.text(prefix, edgeMarks));
    out.push(
      ...this.emit(kids as PhrasingContent[], { ...ctx, marks: innerMarks }, [prefixEnd, suffixStart])
    );
    if (suffix) out.push(this.schema.text(suffix, edgeMarks));
    return out;
  }

  /** 无子节点的定界符节点（代码段、行内公式）：自己切左右定界符 */
  private delimited(
    markName: string,
    node: PhrasingContent,
    ctx: Ctx,
    opts: { literal?: boolean, attrs?: Record<string, unknown> } = {}
  ): Node[] {
    const pos = node.position;
    const from = pos?.start.offset ?? 0;
    const to = pos?.end.offset ?? from;
    const raw = ctx.src.slice(from, to);

    // 代码段用等长反引号定界；公式用 `$`
    const match = markName === "code_inline" ? /^(`+)[\s\S]*\1$/.exec(raw) : /^\$+/.exec(raw);
    const delims = markName === "code_inline" ? match?.[1] ?? "`" : "$";
    const content = raw.slice(delims.length, raw.length - delims.length);

    const mark = this.schema.marks[markName]?.create(opts.attrs ?? {});
    const edgeMarks = mark ? [...ctx.marks, this.syntaxMark(markName), mark] : ctx.marks;
    const innerMarks = mark ? [...ctx.marks, mark] : ctx.marks;

    const out: Node[] = [];
    if (delims) out.push(this.schema.text(delims, edgeMarks));
    if (content) out.push(...this.text(content, from + delims.length, { ...ctx, marks: innerMarks, literal: opts.literal }));
    if (delims) out.push(this.schema.text(delims, edgeMarks));
    return out;
  }

  /**
   * 行内 HTML 配对：`<span>x</span>` / `<sub>2</sub>`
   *
   * mdast 把开闭标签拆成两个独立 html 节点，这里向前找到匹配的闭合标签，
   * 把中间内容套上对应 mark（sub / sup 用专门 mark，其余用 html_inline）。
   */
  private htmlPair(
    kids: PhrasingContent[],
    index: number,
    lastIndex: number,
    ctx: Ctx
  ): { nodes: Node[], end: number, next: number } | null {
    const open = kids[index];
    const openRaw = this.slice(open, ctx.src);
    const match = /^<([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^>]*)?)>$/.exec(openRaw);
    if (!match) return null;

    const tag = match[1].toLowerCase();
    if (VOID_ELEMENTS.has(tag)) return null;

    let depth = 1;
    let closeIndex = -1;
    for (let j = index + 1; j <= lastIndex; j++) {
      const candidate = kids[j];
      if (candidate.type !== "html") continue;
      const raw = this.slice(candidate, ctx.src).trim();
      if (new RegExp(`^</${tag}\\s*>$`, "i").test(raw)) {
        depth--;
        if (depth === 0) {
          closeIndex = j;
          break;
        }
      } else if (new RegExp(`^<${tag}[\\s/>]`, "i").test(raw) && !raw.endsWith("/>")) {
        depth++;
      }
    }
    if (closeIndex === -1) return null;

    const closeRaw = this.slice(kids[closeIndex], ctx.src);
    const markName = tag === "sub" ? "sub" : tag === "sup" ? "sup" : "html_inline";
    const attrs = markName === "html_inline" ? { tag, htmlAttrs: (match[2] ?? "").trim() } : {};
    const mark = this.schema.marks[markName]?.create(attrs);

    const innerFrom = kids[index + 1]?.position?.start.offset
      ?? open.position?.end.offset
      ?? 0;
    const innerTo = kids[closeIndex - 1]?.position?.end.offset ?? innerFrom;

    const out: Node[] = [];
    const edgeMarks = mark ? [...ctx.marks, this.syntaxMark(markName), mark] : ctx.marks;
    const innerMarks = mark ? [...ctx.marks, mark] : ctx.marks;

    out.push(this.schema.text(openRaw, edgeMarks));
    if (closeIndex > index + 1) {
      out.push(...this.emit(kids, { ...ctx, marks: innerMarks }, [innerFrom, innerTo], index + 1, closeIndex - 1));
    }
    out.push(this.schema.text(closeRaw, edgeMarks));

    return {
      nodes: out,
      end: kids[closeIndex].position?.end.offset ?? innerTo,
      next: closeIndex,
    };
  }

  /**
   * 节点之间的空档。
   *
   * 段落/标题里这些空档就是 `#`、`>` 这类结构标记；未标记的文本一律保持可见，
   * 宁可多显示也不隐藏 —— 隐藏未知文本等于静默丢内容。
   */
  private gap(raw: string, absPos: number, ctx: Ctx): Node[] {
    if (!raw) return [];
    if (!ctx.gapSyntaxType) return this.text(raw, absPos, ctx);

    const parts = /^(\s*)(\S[\s\S]*?)(\s*)$/.exec(raw);
    if (!parts || !parts[2]) return this.text(raw, absPos, ctx);

    const out: Node[] = [];
    if (parts[1]) out.push(this.schema.text(parts[1], ctx.marks));
    out.push(this.schema.text(parts[2], [...ctx.marks, this.syntaxMark(ctx.gapSyntaxType)]));
    if (parts[3]) out.push(this.schema.text(parts[3], ctx.marks));
    return out;
  }

  /**
   * 文本输出：逐行应用行首规则（引用块 `>`、列表续行缩进），再交给 `scan`。
   */
  private text(raw: string, absPos: number, ctx: Ctx): Node[] {
    if (!raw) return [];
    if (ctx.literal) return [this.schema.text(raw, ctx.marks)];

    const out: Node[] = [];
    const lines = raw.split("\n");
    let offset = absPos;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const atLineStart = offset === 0 || ctx.src[offset - 1] === "\n";

      if (atLineStart) {
        for (const rule of ctx.prefixes) {
          const consumed = this.consumePrefix(line, rule);
          if (!consumed) continue;
          line = line.slice(consumed.length);
          if (rule.syntaxType) {
            out.push(this.schema.text(consumed, [...ctx.marks, this.syntaxMark(rule.syntaxType)]));
          }
        }
        if (ctx.headMarker && line.startsWith(ctx.headMarker)) {
          const marker = ctx.headMarker;
          ctx.headMarker = null;
          line = line.slice(marker.length);
          out.push(this.schema.text(marker, [...ctx.marks, this.syntaxMark("blockquote")]));
        }
      }

      out.push(...this.scan(line, ctx));
      if (i < lines.length - 1) {
        /*
         * 软换行用节点承载（`hard_break` + raw "\n"），不用裸 "\n" 文本：
         * contenteditable 里裸换行会被浏览器在编辑时规范化成空格，
         * 结果是「随便打一个字，整段的软换行就没了」（行数 -1、内容被改写）。
         * 节点渲染成 <br>，序列化时按 raw 原样输出 "\n"，逐字节往返不变。
         * 代价：换行处不继承外层 mark（`**a\nb**` 的换行不属于 strong）——
         * 序列化结果不受影响。
         */
        out.push(this.schema.node("hard_break", { raw: "\n" }));
        offset += lines[i].length + 1;
      }
    }
    return out;
  }

  private consumePrefix(line: string, rule: LinePrefixRule): string {
    const match = rule.re.exec(line);
    if (!match || !match[0]) return "";
    const text = rule.limit === undefined ? match[0] : match[0].slice(0, rule.limit);
    return text;
  }

  /** 字面文本扫描：转义、HTML 实体、`==高亮==` */
  private scan(raw: string, ctx: Ctx): Node[] {
    const schema = this.schema;
    const out: Node[] = [];
    let buffer = "";

    const flush = () => {
      if (buffer) {
        out.push(schema.text(buffer, ctx.marks));
        buffer = "";
      }
    };

    let i = 0;
    while (i < raw.length) {
      const ch = raw[i];

      if (ch === "\\" && i + 1 < raw.length && ESCAPABLE.test(raw[i + 1])) {
        flush();
        out.push(schema.text("\\", [...ctx.marks, this.syntaxMark("escape")]));
        out.push(schema.text(raw[i + 1], ctx.marks));
        i += 2;
        continue;
      }

      if (ch === "&") {
        const entity = matchHtmlEntityAt(raw, i);
        if (entity) {
          flush();
          out.push(schema.text(entity, [...ctx.marks, this.syntaxMark(HTML_ENTITY_SYNTAX_TYPE)]));
          i += entity.length;
          continue;
        }
      }

      if (ch === "=" && raw[i + 1] === "=") {
        const close = raw.indexOf("==", i + 2);
        if (close > i + 2) {
          flush();
          const mark = schema.marks.highlight.create();
          const content = raw.slice(i + 2, close);
          out.push(schema.text("==", [...ctx.marks, this.syntaxMark("highlight"), mark]));
          out.push(...this.scan(content, { ...ctx, marks: [...ctx.marks, mark] }));
          out.push(schema.text("==", [...ctx.marks, this.syntaxMark("highlight"), mark]));
          i = close + 2;
          continue;
        }
      }

      buffer += ch;
      i++;
    }

    flush();
    return out;
  }

  private syntaxMark(syntaxType: string): Mark {
    return this.schema.marks.syntax_marker.create({ syntaxType });
  }
}

/** 默认解析器实例 */
export const defaultParser = new MarkdownParser();

/**
 * 解析 Markdown 文本
 */
export function parseMarkdown(markdown: string): ParseResult {
  return defaultParser.parse(markdown);
}
