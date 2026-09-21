/**
 * Milkup 语法检测插件
 *
 * 监听文档变化，检测并应用 Markdown 语法的 marks
 * 支持嵌套语法检测，如 ==**text**== 或 ***text***
 */

import { Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Mark, Node, Schema } from "prosemirror-model";
import { decorationPluginKey } from "../decorations";
import { parseMarkdown } from "../parser";
import { findHtmlEntityMatches, HTML_ENTITY_SYNTAX_TYPE } from "../utils/html-entities";
import { findImageTokens } from "../utils/image-token";

/** 插件 Key */
export const syntaxDetectorPluginKey = new PluginKey("milkup-syntax-detector");

/**
 * 本插件负责的行内语义 mark。
 *
 * 注意 `syntax_marker` 是「一码两用」：既装行内语法的定界符（`**` / `==` …，
 * 本插件负责），也装解析器写入的**结构性**标记（Setext 标题的 `=====` 下划线、
 * 引用 `> ` 前缀、列表标记…）。所以它不能按类型一刀切，
 * 必须按 `syntaxType` 判断归属，否则每次编辑都会把结构性标记当「多余」清掉：
 * Setext 标题的下划线会突然露出来（看起来就是闪烁）。
 */
const MANAGED_INLINE_MARKS = new Set([
  "strong",
  "emphasis",
  "code_inline",
  "strikethrough",
  "highlight",
  "link",
  "math_inline",
  "sub",
  "sup",
  "html_inline",
]);

const MANAGED_SYNTAX_TYPES = new Set([...MANAGED_INLINE_MARKS, "escape", HTML_ENTITY_SYNTAX_TYPE]);

/** 会被清理后重新应用的全部 mark 类型 */
const MANAGED_MARK_NAMES = [...MANAGED_INLINE_MARKS, "syntax_marker"];

/** 该 mark 是否由本插件负责（结构性 syntax_marker 不算） */
function isManagedMark(mark: Mark): boolean {
  if (mark.type.name === "syntax_marker") {
    return MANAGED_SYNTAX_TYPES.has(String(mark.attrs?.syntaxType ?? ""));
  }
  return MANAGED_INLINE_MARKS.has(mark.type.name);
}

/** 结构性语法标记：解析器写入，本插件不负责 */
function isStructuralSyntaxMarker(mark: Mark): boolean {
  return mark.type.name === "syntax_marker" && !isManagedMark(mark);
}

/**
 * 清空区间内由本插件管理的 marks，结构性语法标记原样保留。
 *
 * 直接按类型 removeMark 会把 Setext 下划线、`> ` 前缀这类结构标记一起抹掉，
 * 结果就是「随便编辑一下，标题下划线露出来、引用前缀露出来」。
 */
function clearManagedMarks(
  tr: Transaction,
  from: number,
  to: number,
  schema: Schema
): Transaction {
  const preserved: Array<{ from: number; to: number; mark: Mark }> = [];
  tr.doc.nodesBetween(from, to, (child, pos) => {
    if (!child.isText) return true;
    for (const mark of child.marks) {
      if (isStructuralSyntaxMarker(mark)) {
        preserved.push({
          from: Math.max(pos, from),
          to: Math.min(pos + child.nodeSize, to),
          mark,
        });
      }
    }
    return true;
  });

  for (const markTypeName of MANAGED_MARK_NAMES) {
    const markType = schema.marks[markTypeName];
    if (markType) tr = tr.removeMark(from, to, markType);
  }

  for (const item of preserved) {
    tr = tr.addMark(item.from, item.to, item.mark);
  }

  return tr;
}

/** 区间内的文本是否都带着属性一致的 mark */
function rangeHasExactMark(doc: Node, from: number, to: number, desired: Mark): boolean {
  let ok = true;
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true;
    const mark = node.marks.find((m) => m.type.name === desired.type.name);
    if (!mark || !mark.eq(desired)) {
      ok = false;
      return false;
    }
    return true;
  });
  return ok;
}

/**
 * 同步文本块里的图片 mark。
 *
 * 图片是「mark + 真实文本」：语法原样躺在文档里，mark 只负责携带解析出的
 * 属性（src/alt/…）供装饰层渲染。这里做两件事：
 *   1. 每个图片 token 的范围都带上属性一致的 mark（用户改了 src 也会更新）；
 *   2. 语法被改坏后失效的 mark 摘掉，露出原文。
 */
function syncImageMarks(tr: Transaction, schema: Schema): void {
  const imageType = schema.marks.image;
  if (!imageType) return;

  const ops: Array<{ from: number; to: number; mark?: Mark }> = [];

  tr.doc.descendants((node, pos) => {
    if (!(node.isTextblock && !node.type.spec.code)) return true;

    const base = pos + 1;
    const text = node.textContent;
    const tokens = findImageTokens(text);

    for (const token of tokens) {
      const from = base + token.from;
      const to = base + token.to;
      const desired = imageType.create({
        src: token.src,
        alt: token.alt,
        title: token.title,
        linkHref: token.linkHref,
        linkTitle: token.linkTitle,
      });
      if (!rangeHasExactMark(tr.doc, from, to, desired)) {
        ops.push({ from, to, mark: desired });
      }
    }

    // 失效 mark 清理：带 mark 但不再被任何完整 token 覆盖的文本。
    // 上界用「内容结束」而不是 node.nodeSize：后者 = 内容 + 2（前后标记各 1），
    // 对文档里最后一个文本块会越过 doc 末尾，nodesBetween 直接抛越界异常。
    const contentEnd = base + node.content.size;
    tr.doc.nodesBetween(base, contentEnd, (child, childPos) => {
      if (!child.isText) return true;
      if (!child.marks.some((m) => m.type.name === "image")) return true;
      const from = Math.max(childPos, base);
      const to = Math.min(childPos + child.nodeSize, contentEnd);
      const fullyInToken = tokens.some((t) => from - base >= t.from && to - base <= t.to);
      if (!fullyInToken) ops.push({ from, to });
      return true;
    });

    return true;
  });

  // 从后往前应用，避免位置偏移
  ops.sort((a, b) => b.from - a.from);
  for (const op of ops) {
    tr.removeMark(op.from, op.to, imageType);
    if (op.mark) tr.addMark(op.from, op.to, op.mark);
  }
}

function isCompleteMarkdownTable(lines: string[]): boolean {
  if (lines.length < 2) return false;
  if (lines.some((line) => line.trim() === "")) return false;

  const tableRowPattern = /^\|(.+)\|\s*$/;
  const tableSeparatorPattern = /^\|[-:\s|]+\|\s*$/;

  if (!tableRowPattern.test(lines[0])) return false;
  if (!tableSeparatorPattern.test(lines[1])) return false;

  const expectedColumnCount = lines[0].trimEnd().slice(1, -1).split("|").length;
  if (expectedColumnCount === 0) return false;
  if (lines[1].trimEnd().slice(1, -1).split("|").length !== expectedColumnCount) return false;

  for (let index = 2; index < lines.length; index++) {
    if (!tableRowPattern.test(lines[index])) return false;
    if (lines[index].trimEnd().slice(1, -1).split("|").length !== expectedColumnCount) {
      return false;
    }
  }

  return true;
}

function parseMarkdownTableNode(lines: string[]): Node | null {
  if (lines.length < 3) return null;
  if (!isCompleteMarkdownTable(lines)) return null;

  const result = parseMarkdown(lines.join("\n"));
  let tableNode: Node | null = null;
  let nodeCount = 0;

  result.doc.forEach((node) => {
    nodeCount++;
    if (node.type.name === "table" && !tableNode) {
      tableNode = node;
    }
  });

  return nodeCount === 1 ? tableNode : null;
}

function isPlainTableParagraph(node: Node): boolean {
  return (
    node.type.name === "paragraph" &&
    !node.attrs.codeBlockId &&
    !node.attrs.tableId &&
    !node.attrs.htmlBlockId &&
    !node.attrs.mathBlockId &&
    !node.attrs.listId &&
    node.textContent.trimStart().startsWith("|")
  );
}

function getHeadingSyntaxPrefixLength(text: string, level: number): number {
  const hashes = "#".repeat(level);
  if (!text.startsWith(hashes)) return 0;

  if (text.length === level) return level;

  let offset = level;
  if (!/\s/.test(text[offset])) return 0;

  while (offset < text.length && /\s/.test(text[offset])) {
    offset++;
  }

  return offset;
}

/** 行内语法定义 */
interface InlineSyntax {
  type: string;
  pattern: RegExp;
  prefix: string | ((match: RegExpExecArray) => string);
  suffix: string | ((match: RegExpExecArray) => string);
  contentIndex: number;
  getAttrs?: (match: RegExpExecArray) => Record<string, any>;
  // 对于 strong_emphasis，需要应用多个 marks
  multiMarks?: string[];
}

/** 行内语法列表 - 按优先级排序 */
const INLINE_SYNTAXES: InlineSyntax[] = [
  // 粗斜体 ***text*** 或 ___text___
  {
    type: "strong_emphasis",
    pattern: /(\*\*\*|___)(.+?)\1/g,
    prefix: (m) => m[1],
    suffix: (m) => m[1],
    contentIndex: 2,
    multiMarks: ["strong", "emphasis"],
  },
  // 粗体 **text** 或 __text__
  {
    type: "strong",
    pattern: /(?<!\*)(\*\*)(?!\*)(.+?)(?<!\*)\1(?!\*)|(?<!_)(__)(?!_)(.+?)(?<!_)\1(?!_)/g,
    prefix: (m) => m[1] || m[3],
    suffix: (m) => m[1] || m[3],
    contentIndex: 2,
    getAttrs: (m) => ({}),
  },
  // 斜体 *text* 或 _text_
  // 注意：下划线在单词中间时不应该被视为斜体标记
  {
    type: "emphasis",
    pattern:
      /(?<![*_\w])(\*)(?![*\s])(.+?)(?<![*\s])\1(?![*])|(?<![*_])(_)(?![_\s])(?=\S)(.+?)(?<=\S)(?<![_\s])\3(?![_\w])/g,
    prefix: (m) => m[1] || m[3],
    suffix: (m) => m[1] || m[3],
    contentIndex: 2,
  },
  // 行内代码 `code`
  {
    type: "code_inline",
    pattern: /`([^`]+)`/g,
    prefix: "`",
    suffix: "`",
    contentIndex: 1,
  },
  // 删除线 ~~text~~
  {
    type: "strikethrough",
    pattern: /~~(.+?)~~/g,
    prefix: "~~",
    suffix: "~~",
    contentIndex: 1,
  },
  // 高亮 ==text==
  {
    type: "highlight",
    // 内容里不允许再出现 `=`：否则 Setext 标题的下划线（`===============`）
    // 会被当成 `==` + `=` + `==` 的高亮语法，编辑时反复加/去 mark，
    // 表现为标题下划线闪烁、甚至被 syntax-fixer 摘掉 mark 后整行露出来。
    pattern: /==([^=]+?)==/g,
    prefix: "==",
    suffix: "==",
    contentIndex: 1,
  },
  // 链接 [text](url) - 支持 URL 中的转义括号如 \( \)
  {
    type: "link",
    pattern: /(?<!!)\[([^\]]+)\]\(((?:[^)\s\\]|\\.)*?)(?:\s+"([^"]*)")?\)/g,
    prefix: "[",
    suffix: (m) => `](${m[2] || ""}${m[3] ? ` "${m[3]}"` : ""})`,
    contentIndex: 1,
    getAttrs: (m) => ({ href: (m[2] || "").replace(/\\([()])/g, "$1"), title: m[3] || "" }),
  },
  // 行内数学 $content$
  {
    type: "math_inline",
    pattern: /(?<!\$)\$(?!\$)([^$]+)\$(?!\$)/g,
    prefix: "$",
    suffix: "$",
    contentIndex: 1,
    getAttrs: (m) => ({ content: m[1] }),
  },
  // 下标 <sub>text</sub>
  {
    type: "sub",
    pattern: /<sub>(.+?)<\/sub>/g,
    prefix: "<sub>",
    suffix: "</sub>",
    contentIndex: 1,
  },
  // 上标 <sup>text</sup>
  {
    type: "sup",
    pattern: /<sup>(.+?)<\/sup>/g,
    prefix: "<sup>",
    suffix: "</sup>",
    contentIndex: 1,
  },
  // 通用行内 HTML <tag attrs>content</tag>（排除已由专用 mark 处理的 sub/sup）
  {
    type: "html_inline",
    pattern: /<([a-zA-Z][a-zA-Z0-9]*)(\s(?:[^>"']|"[^"]*"|'[^']*')*)?>(.+?)<\/\1>/g,
    prefix: (m: RegExpExecArray) => `<${m[1]}${m[2] || ""}>`,
    suffix: (m: RegExpExecArray) => `</${m[1]}>`,
    contentIndex: 3,
    getAttrs: (m: RegExpExecArray) => ({ tag: m[1].toLowerCase(), htmlAttrs: (m[2] || "").trim() }),
  },
];

/** 转义正则 */
const ESCAPE_RE = /\\([\\`*_{}[\]()#+\-.!|~=$>])/g;

/** 匹配信息 */
interface MatchInfo {
  syntax: InlineSyntax;
  match: RegExpExecArray;
  start: number;
  end: number;
  prefix: string;
  suffix: string;
  content: string;
  contentStart: number;
  contentEnd: number;
  attrs?: Record<string, any>;
}

interface DetectedRegion {
  from: number;
  to: number;
  markTypes: string[];
  isSyntax: boolean;
  isEscape?: boolean;
  syntaxType?: string;
  attrs?: Record<string, any>;
}

/**
 * 检测文本中的所有语法匹配
 */
function detectSyntaxMatches(text: string): MatchInfo[] {
  const matches: MatchInfo[] = [];

  // 收集所有转义范围
  const escapeRanges: Array<{ start: number; end: number }> = [];
  const escRe = new RegExp(ESCAPE_RE.source, "g");
  let escMatch: RegExpExecArray | null;
  while ((escMatch = escRe.exec(text)) !== null) {
    escapeRanges.push({ start: escMatch.index, end: escMatch.index + escMatch[0].length });
  }

  // 先收集链接匹配的范围，链接 URL 内的转义不应阻止链接匹配
  const linkRanges: Array<{ start: number; end: number }> = [];
  const linkSyntax = INLINE_SYNTAXES.find((s) => s.type === "link");
  if (linkSyntax) {
    const linkRe = new RegExp(linkSyntax.pattern.source, linkSyntax.pattern.flags);
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRe.exec(text)) !== null) {
      linkRanges.push({ start: linkMatch.index, end: linkMatch.index + linkMatch[0].length });
    }
  }

  for (const syntax of INLINE_SYNTAXES) {
    const re = new RegExp(syntax.pattern.source, syntax.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
      const prefix = typeof syntax.prefix === "function" ? syntax.prefix(match) : syntax.prefix;
      const suffix = typeof syntax.suffix === "function" ? syntax.suffix(match) : syntax.suffix;
      const content = match[syntax.contentIndex] || match[syntax.contentIndex + 2] || "";

      const start = match.index;
      const end = start + match[0].length;
      const contentStart = start + prefix.length;
      const contentEnd = end - suffix.length;

      // 跳过与转义范围重叠的匹配，但链接和行内数学除外
      // （链接 URL 内允许转义括号，数学公式内的 \| \hat 等是 LaTeX 命令）
      if (syntax.type !== "link" && syntax.type !== "math_inline") {
        const overlapsEscape = escapeRanges.some((esc) => esc.start < end && esc.end > start);
        if (overlapsEscape) continue;
      }

      matches.push({
        syntax,
        match,
        start,
        end,
        prefix,
        suffix,
        content,
        contentStart,
        contentEnd,
        attrs: syntax.getAttrs?.(match),
      });
    }
  }

  // 按位置排序，相同起点时更长的优先
  matches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end;
  });

  // 过滤完全重叠的匹配（保留外层）
  const filtered: MatchInfo[] = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  return filtered;
}

/**
 * 检测普通文本片段中的转义序列和 HTML entity，生成区域标记
 */
function detectPlainTextRegions(
  text: string,
  baseOffset: number,
  inheritedTypes: string[],
  inheritedAttrs?: Record<string, any>
): DetectedRegion[] {
  const results: DetectedRegion[] = [];
  const events: Array<{ start: number; end: number; type: "escape" | "html_entity" }> = [];

  const escRe = new RegExp(ESCAPE_RE.source, "g");
  let escMatch: RegExpExecArray | null;
  while ((escMatch = escRe.exec(text)) !== null) {
    events.push({ start: escMatch.index, end: escMatch.index + 2, type: "escape" });
  }

  const canRenderEntities = !inheritedTypes.some((type) =>
    ["code_inline", "math_inline"].includes(type)
  );
  if (canRenderEntities) {
    for (const entity of findHtmlEntityMatches(text)) {
      events.push({ start: entity.from, end: entity.to, type: "html_entity" });
    }
  }

  if (events.length === 0) return results;

  events.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end;
  });

  let pos = 0;
  for (const event of events) {
    if (event.start < pos) continue;

    if (event.start > pos && inheritedTypes.length > 0) {
      results.push({
        from: baseOffset + pos,
        to: baseOffset + event.start,
        markTypes: inheritedTypes,
        isSyntax: false,
        attrs: inheritedAttrs,
      });
    }

    if (event.type === "escape") {
      // `\` 字符 → escape 类型的 syntax_marker
      results.push({
        from: baseOffset + event.start,
        to: baseOffset + event.start + 1,
        markTypes: inheritedTypes,
        isSyntax: true,
        isEscape: true,
        syntaxType: "escape",
        attrs: inheritedAttrs,
      });

      // 被转义的字符 → 普通文本（只带 inheritedTypes）
      results.push({
        from: baseOffset + event.start + 1,
        to: baseOffset + event.end,
        markTypes: inheritedTypes,
        isSyntax: false,
        attrs: inheritedAttrs,
      });
    } else {
      results.push({
        from: baseOffset + event.start,
        to: baseOffset + event.end,
        markTypes: inheritedTypes,
        isSyntax: true,
        syntaxType: HTML_ENTITY_SYNTAX_TYPE,
        attrs: inheritedAttrs,
      });
    }

    pos = event.end;
  }

  // 剩余文本
  if (pos < text.length && inheritedTypes.length > 0) {
    results.push({
      from: baseOffset + pos,
      to: baseOffset + text.length,
      markTypes: inheritedTypes,
      isSyntax: false,
      attrs: inheritedAttrs,
    });
  }

  return results;
}

/**
 * 递归检测嵌套语法
 */
function detectNestedSyntax(
  text: string,
  baseOffset: number,
  inheritedTypes: string[],
  inheritedAttrs?: Record<string, any>
): DetectedRegion[] {
  const results: DetectedRegion[] = [];

  const matches = detectSyntaxMatches(text);

  if (matches.length === 0) {
    // 没有语法匹配，检查普通文本中的转义和 HTML entity
    if (text.length > 0) {
      const plainRegions = detectPlainTextRegions(text, baseOffset, inheritedTypes, inheritedAttrs);
      if (plainRegions.length > 0) {
        results.push(...plainRegions);
        return results;
      }
    }
    if (text.length > 0 && inheritedTypes.length > 0) {
      results.push({
        from: baseOffset,
        to: baseOffset + text.length,
        markTypes: inheritedTypes,
        isSyntax: false,
        attrs: inheritedAttrs,
      });
    }
    return results;
  }

  let pos = 0;
  for (const m of matches) {
    // 前面的纯文本（可能包含转义）
    if (m.start > pos) {
      const plainText = text.slice(pos, m.start);
      const plainRegions = detectPlainTextRegions(
        plainText,
        baseOffset + pos,
        inheritedTypes,
        inheritedAttrs
      );
      if (plainRegions.length > 0) {
        results.push(...plainRegions);
      } else if (plainText.length > 0 && inheritedTypes.length > 0) {
        results.push({
          from: baseOffset + pos,
          to: baseOffset + m.start,
          markTypes: inheritedTypes,
          isSyntax: false,
          attrs: inheritedAttrs,
        });
      }
    }

    // 当前语法的 mark 类型
    const currentTypes = m.syntax.multiMarks || [m.syntax.type];
    const allTypes = [...inheritedTypes, ...currentTypes];

    // 合并 attrs：继承的 attrs + 当前语法的 attrs
    const mergedAttrs = m.attrs
      ? inheritedAttrs
        ? { ...inheritedAttrs, ...m.attrs }
        : m.attrs
      : inheritedAttrs;

    // 前缀（语法标记）
    results.push({
      from: baseOffset + m.start,
      to: baseOffset + m.contentStart,
      markTypes: allTypes,
      isSyntax: true,
      attrs: mergedAttrs,
    });

    // 递归处理内容（传递合并后的 attrs）
    // 数学公式内容不做嵌套语法检测（\| \hat 等是 LaTeX 命令，不是 Markdown 语法）
    if (m.syntax.type === "math_inline") {
      if (m.content.length > 0) {
        results.push({
          from: baseOffset + m.contentStart,
          to: baseOffset + m.contentEnd,
          markTypes: allTypes,
          isSyntax: false,
          attrs: mergedAttrs,
        });
      }
    } else {
      const innerResults = detectNestedSyntax(
        m.content,
        baseOffset + m.contentStart,
        allTypes,
        mergedAttrs
      );
      if (innerResults.length > 0) {
        results.push(...innerResults);
      } else if (m.content.length > 0) {
        // 没有嵌套语法，直接添加内容
        results.push({
          from: baseOffset + m.contentStart,
          to: baseOffset + m.contentEnd,
          markTypes: allTypes,
          isSyntax: false,
          attrs: mergedAttrs,
        });
      }
    }

    // 后缀（语法标记）
    results.push({
      from: baseOffset + m.contentEnd,
      to: baseOffset + m.end,
      markTypes: allTypes,
      isSyntax: true,
      attrs: mergedAttrs,
    });

    pos = m.end;
  }

  // 剩余文本（可能包含转义）
  if (pos < text.length) {
    const remainingText = text.slice(pos);
    const plainRegions = detectPlainTextRegions(
      remainingText,
      baseOffset + pos,
      inheritedTypes,
      inheritedAttrs
    );
    if (plainRegions.length > 0) {
      results.push(...plainRegions);
    } else if (remainingText.length > 0 && inheritedTypes.length > 0) {
      results.push({
        from: baseOffset + pos,
        to: baseOffset + text.length,
        markTypes: inheritedTypes,
        isSyntax: false,
        attrs: inheritedAttrs,
      });
    }
  }

  return results;
}

/**
 * 检查节点是否已经有正确的 marks
 * 改进版：更精确地比较当前 marks 和期望的 marks
 * @param skipOffset 跳过节点开头的字符数（如标题的 ### 前缀），这些位置不参与比较
 */
function hasCorrectMarks(
  node: Node,
  basePos: number,
  regions: ReturnType<typeof detectNestedSyntax>,
  skipOffset: number = 0
): boolean {
  if (regions.length === 0) {
    // 如果没有期望区域，检查内容区是否仍残留由本插件管理的 marks。
    let hasAnyManagedMarks = false;
    let offset = 0;
    node.forEach((child) => {
      if (child.isText) {
        const childStart = basePos + offset;
        const childEnd = childStart + child.nodeSize;
        if (childEnd > basePos + skipOffset) {
          // 结构性语法标记（Setext 下划线、`> ` 前缀…）不属于本插件，忽略
          const managedMarks = child.marks.filter(isManagedMark);
          if (managedMarks.length > 0) {
            hasAnyManagedMarks = true;
          }
        }
      }
      offset += child.nodeSize;
    });
    return !hasAnyManagedMarks;
  }

  // 构建期望的 marks 映射：position -> expected mark types
  const expectedMarks = new Map<number, Set<string>>();
  // 构建期望的 attrs 映射：position -> { markType -> attrs }
  const expectedAttrs = new Map<number, Map<string, Record<string, any>>>();
  for (const region of regions) {
    for (let pos = region.from; pos < region.to; pos++) {
      if (!expectedMarks.has(pos)) {
        expectedMarks.set(pos, new Set());
        expectedAttrs.set(pos, new Map());
      }
      for (const markType of region.markTypes) {
        if (markType !== "strong_emphasis") {
          expectedMarks.get(pos)!.add(markType);
          // 记录带 attrs 的 mark（如 link 的 href、html_inline 的 tag）
          if (
            region.attrs &&
            (markType === "link" || markType === "math_inline" || markType === "html_inline")
          ) {
            expectedAttrs.get(pos)!.set(markType, region.attrs);
          }
        }
      }
      // 添加 syntax_marker
      if (region.isSyntax) {
        expectedMarks.get(pos)!.add("syntax_marker");
      }
    }
  }

  // 检查实际的 marks 是否与期望一致
  let offset = 0;
  let allMatch = true;

  node.forEach((child) => {
    if (child.isText && allMatch) {
      const childStart = basePos + offset;
      const childEnd = childStart + child.nodeSize;

      for (let pos = childStart; pos < childEnd; pos++) {
        // 跳过标题前缀等结构性语法标记的位置
        if (pos < basePos + skipOffset) continue;

        const expected = expectedMarks.get(pos) || new Set();
        const actual = new Set(
          child.marks
            // 结构性语法标记不计入比较：它们不由本插件产生，也不该被它清掉
            .filter(isManagedMark)
            .map((m) => m.type.name)
        );

        // 比较期望和实际的 marks
        if (expected.size !== actual.size) {
          allMatch = false;
          break;
        }

        for (const markType of expected) {
          if (!actual.has(markType)) {
            allMatch = false;
            break;
          }
        }

        // 检查带 attrs 的 mark（如 link 的 href）是否一致
        if (allMatch) {
          const posAttrs = expectedAttrs.get(pos);
          if (posAttrs && posAttrs.size > 0) {
            for (const [markTypeName, expectedAttr] of posAttrs) {
              const actualMark = child.marks.find((m) => m.type.name === markTypeName);
              if (actualMark) {
                for (const [key, val] of Object.entries(expectedAttr)) {
                  if (actualMark.attrs[key] !== val) {
                    allMatch = false;
                    break;
                  }
                }
              }
              if (!allMatch) break;
            }
          }
        }

        if (!allMatch) break;
      }
    }
    offset += child.nodeSize;
  });

  return allMatch;
}

/**
 * 创建语法检测插件
 */
export function createSyntaxDetectorPlugin(): Plugin {
  return new Plugin({
    key: syntaxDetectorPluginKey,

    appendTransaction(transactions, oldState, newState) {
      // 只在文档变化时处理
      const docChanged = transactions.some((tr) => tr.docChanged);
      if (!docChanged) return null;

      // 跳过语法插件自身产生的 transaction，避免循环
      if (transactions.some((tr) => tr.getMeta("syntax-plugin-internal"))) return null;

      const schema = newState.schema;
      let tr = newState.tr;
      tr = tr.setMeta("syntax-plugin-internal", true);
      let hasChanges = false;

      // 遍历所有文本块（跳过代码块/数学块等，其内容不参与语法解析）
      newState.doc.descendants((node, pos) => {
        if (node.isTextblock && !node.type.spec.code) {
          // 跳过源码视图中由代码块拆分出的段落，不做任何语法检测
          if (node.attrs.codeBlockId) return true;

          let textContent = node.textContent;
          const basePos = pos + 1;
          let contentOffset = 0;

          // 对于标题节点，跳过标题语法前缀（如 "### "），避免语法检测器
          // 误移除标题前缀上的 syntax_marker(heading) 标记
          if (node.type.name === "heading") {
            const level = node.attrs.level as number;
            const prefixLength = getHeadingSyntaxPrefixLength(textContent, level);
            if (prefixLength > 0) {
              contentOffset = prefixLength;
              textContent = textContent.slice(contentOffset);
            }
          }

          // 引用块内部段落会保留 "> " 作为结构性语法标记，不参与行内语法重扫。
          if (node.type.name === "paragraph" && textContent.startsWith("> ")) {
            const firstChild = node.firstChild;
            const hasBlockquotePrefix =
              firstChild?.isText &&
              firstChild.text?.startsWith("> ") &&
              firstChild.marks.some(
                (m) => m.type.name === "syntax_marker" && m.attrs.syntaxType === "blockquote"
              );
            if (hasBlockquotePrefix) {
              contentOffset = 2;
              textContent = textContent.slice(contentOffset);
            }
          }

          // 检测所有语法区域
          const regions = detectNestedSyntax(textContent, basePos + contentOffset, []);

          // 检查是否需要更新
          if (hasCorrectMarks(node, basePos, regions, contentOffset)) return true;

          if (regions.length === 0) {
            // 没有检测到语法但存在残留 marks，需要清除（结构性标记除外）
            tr = clearManagedMarks(tr, basePos + contentOffset, basePos + node.content.size, schema);
            hasChanges = true;
            return true;
          }

          // 先清理内容区内由本插件管理的旧 marks，避免用户改动后残留旧语法标记。
          const cleanFrom = basePos + contentOffset;
          const cleanTo = basePos + node.content.size;
          tr = clearManagedMarks(tr, cleanFrom, cleanTo, schema);

          // 应用 marks
          for (const region of regions) {
            // 移除该区域由本插件管理的旧 marks（含 syntax_marker），再重新应用
            tr = clearManagedMarks(tr, region.from, region.to, schema);

            // 添加新的 marks
            for (const markTypeName of region.markTypes) {
              if (markTypeName === "strong_emphasis") continue; // 跳过复合类型

              const markType = schema.marks[markTypeName];
              if (markType) {
                const mark = markType.create(region.attrs);
                tr = tr.addMark(region.from, region.to, mark);
              }
            }

            // 添加 syntax_marker
            if (region.isSyntax) {
              const syntaxMarkerType = schema.marks.syntax_marker;
              if (syntaxMarkerType) {
                const syntaxType =
                  region.syntaxType || region.markTypes[region.markTypes.length - 1] || "unknown";
                const syntaxMark = syntaxMarkerType.create({ syntaxType });
                tr = tr.addMark(region.from, region.to, syntaxMark);
              }
            }

            hasChanges = true;
          }
        }
        return true;
      });

      // 检测图片语法并转换为图片节点（源码模式下跳过，避免与 source-view-transform 插件循环）
      const decoState = decorationPluginKey.getState(newState);
      const isSourceView = decoState?.sourceView ?? false;
      if (!isSourceView) {
        const tablesToConvert: Array<{ from: number; to: number; table: Node }> = [];
        const excludedTableScanParents = new Set([
          "table",
          "table_row",
          "table_cell",
          "table_header",
          "code_block",
          "html_block",
          "math_block",
        ]);

        const scanTableParagraphs = (parent: Node, contentStartPos: number) => {
          let group: Array<{ node: Node; pos: number }> = [];

          const flushGroup = () => {
            if (group.length === 0) return;
            const table = parseMarkdownTableNode(group.map((item) => item.node.textContent));
            if (table) {
              const first = group[0];
              const last = group[group.length - 1];
              tablesToConvert.push({
                from: first.pos,
                to: last.pos + last.node.nodeSize,
                table,
              });
            }
            group = [];
          };

          parent.forEach((child, offset) => {
            const childPos = contentStartPos + offset;

            if (isPlainTableParagraph(child)) {
              group.push({ node: child, pos: childPos });
              return;
            }

            flushGroup();

            if (child.content.size > 0 && !excludedTableScanParents.has(child.type.name)) {
              scanTableParagraphs(child, childPos + 1);
            }
          });

          flushGroup();
        };

        scanTableParagraphs(newState.doc, 0);

        if (tablesToConvert.length > 0) {
          tablesToConvert.sort((a, b) => b.from - a.from);
          for (const table of tablesToConvert) {
            tr = tr.replaceWith(table.from, table.to, table.table);
          }
          return tr;
        }

        // 检测 HTML 块语法（段落以 <tagname 开头）并转换为 html_block 节点
        const htmlBlockPattern = /^<([a-zA-Z][a-zA-Z0-9]*)/;
        // 验证开始标签结构完整（必须有闭合的 >）
        const validOpenTagPattern = /^<[a-zA-Z][a-zA-Z0-9]*(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?>/;
        const voidElements = new Set([
          "area",
          "base",
          "br",
          "col",
          "embed",
          "hr",
          "img",
          "input",
          "link",
          "meta",
          "param",
          "source",
          "track",
          "wbr",
        ]);
        // 行内元素不应转换为块级 html_block，它们应在行内显示
        const inlineElements = new Set([
          "a",
          "abbr",
          "b",
          "bdi",
          "bdo",
          "cite",
          "code",
          "data",
          "dfn",
          "em",
          "i",
          "kbd",
          "mark",
          "q",
          "rp",
          "rt",
          "ruby",
          "s",
          "samp",
          "small",
          "span",
          "strong",
          "sub",
          "sup",
          "time",
          "u",
          "var",
          "del",
          "ins",
          "label",
          "font",
        ]);
        const htmlToConvert: Array<{ pos: number; text: string }> = [];

        newState.doc.descendants((node, pos) => {
          if (
            node.type.name === "paragraph" &&
            !node.attrs.codeBlockId &&
            !node.attrs.tableId &&
            !node.attrs.htmlBlockId &&
            !node.attrs.mathBlockId
          ) {
            const text = node.textContent;
            const match = text.match(htmlBlockPattern);
            if (match && !/^<(?:https?:\/\/|mailto:)/i.test(text)) {
              const tagName = match[1];
              // 跳过行内元素，它们不应转为块级 html_block
              if (inlineElements.has(tagName.toLowerCase())) return true;
              const isVoid =
                voidElements.has(tagName.toLowerCase()) || text.trimEnd().endsWith("/>");
              // 对于非 void 元素，验证开始标签结构完整性
              if (!isVoid && !validOpenTagPattern.test(text)) return true;
              const closePattern = new RegExp(`</${tagName}\\s*>`, "i");
              const hasClosing = closePattern.test(text);
              if (isVoid || hasClosing) {
                htmlToConvert.push({ pos, text });
              }
            }
          }
          return true;
        });

        // 从后往前替换，避免位置偏移
        for (const h of htmlToConvert.reverse()) {
          const htmlNode = schema.nodes.html_block.create({}, h.text ? schema.text(h.text) : []);
          tr = tr.replaceWith(h.pos, h.pos + tr.doc.nodeAt(h.pos)!.nodeSize, htmlNode);
          hasChanges = true;
        }

        // 检测标题语法（段落以 #{1,6} 开头）并转换为标题节点
        const headingPattern = /^(#{1,6})\s+(.*)/;
        const headingsToConvert: Array<{
          pos: number;
          level: number;
          hashLength: number;
        }> = [];

        newState.doc.descendants((node, pos) => {
          if (
            node.type.name === "paragraph" &&
            !node.attrs.codeBlockId &&
            !node.attrs.tableId &&
            !node.attrs.htmlBlockId &&
            !node.attrs.mathBlockId
          ) {
            const textContent = node.textContent;
            const match = textContent.match(headingPattern);
            if (match) {
              headingsToConvert.push({
                pos,
                level: match[1].length,
                hashLength: match[1].length,
              });
            }
          }
          return true;
        });

        // 使用 setBlockType 只改变节点类型，保留原始文本内容（包括空格）不变
        const headingNodeType = schema.nodes.heading;
        const syntaxMarkerType = schema.marks.syntax_marker;
        if (headingNodeType && headingsToConvert.length > 0) {
          for (const h of headingsToConvert) {
            // 将段落转换为标题（保留原有文本内容不变）
            tr = tr.setBlockType(h.pos + 1, h.pos + 1, headingNodeType, { level: h.level });
            // 给 # 标记添加 syntax_marker
            if (syntaxMarkerType) {
              const syntaxMark = syntaxMarkerType.create({ syntaxType: "heading" });
              tr = tr.addMark(h.pos + 1, h.pos + 1 + h.hashLength, syntaxMark);
            }
            hasChanges = true;
          }
        }

        // 图片：文本块里的图片语法 → 打上 image mark（原文保留为真实文本，
        // 显示原文还是渲染成图由装饰层决定）。放在最后执行，避免前面会改尺寸的
        // 转换让位置失配。
        syncImageMarks(tr, schema);
        if (tr.docChanged) hasChanges = true;
      } // end if (!isSourceView)

      return hasChanges ? tr : null;
    },
  });
}
