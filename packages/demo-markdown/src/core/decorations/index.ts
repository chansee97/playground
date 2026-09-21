/**
 * Milkup 装饰系统 v2
 *
 * 基于 syntax_marker mark 的即时渲染装饰系统
 * 语法标记是真实的文本内容，光标可以自由移动
 * 装饰只控制显示/隐藏，不改变文档结构
 */

import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import {
  EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  Transaction,
} from "prosemirror-state";
import { Node } from "prosemirror-model";
import { renderInlineMath } from "../nodeviews/math-block";
import { sourceViewRegistry } from "../nodeviews/view-registry";
import { resolveImageSrc } from "../utils/image-path";
import {
  convertBlocksToParagraphs,
  convertParagraphsToBlocks,
  needsSourceViewConversion,
  sourceViewTransformAppliedMeta,
} from "../plugins/source-view-transform";
import { decodeHtmlEntity, HTML_ENTITY_SYNTAX_TYPE } from "../utils/html-entities";
import { getSelectionViewportOffset, restoreSelectionViewportOffset } from "../utils/viewport";

// ============ 源码模式状态 ============

/**
 * 源码视图状态按 `EditorView` 实例隔离，状态的唯一真相是下面的 plugin state。
 * 这里只做类型再导出，保持既有的公开导出路径不变。
 */
export type { SourceViewListener } from "../nodeviews/view-registry";

/** 装饰插件状态 */
export interface DecorationPluginState {
  decorations: DecorationSet;
  activeRegions: SyntaxMarkerRegion[];
  sourceView: boolean;
  cachedSyntaxRegions: SyntaxMarkerRegion[];
  cachedMathInlineRegions: MathInlineRegion[];
  cachedImageRegions: ImageRegion[];
  /**
   * 上一次算装饰时的「光标上下文」指纹。
   *
   * 装饰集对选区的依赖被压缩成这个指纹：指纹没变就说明重算的结果会逐项相同，
   * 于是可以整体复用上一次的 DecorationSet，不必重建 N 个 Decoration 再排序建树。
   */
  cursorKey: string;
}

/** 语法标记区域 */
export interface SyntaxMarkerRegion {
  from: number;
  to: number;
  syntaxType: string;
}

/** 装饰插件 Key */
export const decorationPluginKey = new PluginKey<DecorationPluginState>("milkup-decorations");

const SOURCE_VIEW_CURSOR_MARKER_PREFIX = "\uE000milkup-source-view-cursor-";
const SOURCE_VIEW_CURSOR_MARKER_SUFFIX = "\uE001";

function isOffsetInsideLinePrefix(text: string, offset: number, prefixPattern: RegExp): boolean {
  const prefix = text.match(prefixPattern)?.[0];
  return prefix ? offset < prefix.length : true;
}

function isSourceParagraphWithStructuralSyntax(node: Node, offset: number): boolean {
  if (node.type.name !== "paragraph") return false;

  if (node.attrs.codeBlockId) {
    const lineIndex = node.attrs.lineIndex as number;
    const totalLines = node.attrs.totalLines as number;
    return lineIndex === 0 || lineIndex === totalLines - 1;
  }

  if (node.attrs.mathBlockId) {
    const lineIndex = node.attrs.mathBlockLineIndex as number;
    const totalLines = node.attrs.mathBlockTotalLines as number;
    return lineIndex === 0 || lineIndex === totalLines - 1;
  }

  if (node.attrs.listId) {
    return isOffsetInsideLinePrefix(
      node.textContent,
      offset,
      /^\s*(?:(?:[-*+]\s+\[[ xX]\]\s+)|(?:[-*+]|\d+\.)\s+|\s+)/
    );
  }

  if (node.attrs.blockquoteId) {
    return isOffsetInsideLinePrefix(node.textContent, offset, /^\s*(?:>\s*)+/);
  }

  if (node.attrs.tableId) {
    const rowIndex = node.attrs.tableRowIndex as number;
    const touchesCellBoundary =
      node.textContent[offset] === "|" || node.textContent[Math.max(0, offset - 1)] === "|";
    return rowIndex === 1 || touchesCellBoundary;
  }

  return Boolean(
    node.attrs.hrSource ||
    node.attrs.htmlBlockId ||
    node.attrs.blockquoteSeparator ||
    node.textContent.trimStart().startsWith("|")
  );
}

function createSourceViewCursorMarker(): string {
  return `${SOURCE_VIEW_CURSOR_MARKER_PREFIX}${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}${SOURCE_VIEW_CURSOR_MARKER_SUFFIX}`;
}

function addSourceViewCursorMarker(
  tr: Transaction,
  state: EditorState,
  isSourceView: boolean
): string | null {
  const $head = state.selection.$head;
  if (!$head.parent.inlineContent) return null;
  if (isSourceView && isSourceParagraphWithStructuralSyntax($head.parent, $head.parentOffset)) {
    return null;
  }

  const marker = createSourceViewCursorMarker();
  try {
    tr.insertText(marker, state.selection.head);
    return marker;
  } catch {
    return null;
  }
}

function restoreSourceViewCursorMarker(tr: Transaction, marker: string | null): boolean {
  if (!marker) return false;

  let markerPos: number | null = null;
  tr.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;

    const markerIndex = node.text.indexOf(marker);
    if (markerIndex === -1) return true;

    markerPos = pos + markerIndex;
    return false;
  });

  if (markerPos === null) return false;

  tr.delete(markerPos, markerPos + marker.length);
  const safePos = Math.min(markerPos, tr.doc.content.size);
  tr.setSelection(Selection.near(tr.doc.resolve(safePos), 1));
  return true;
}

/** CSS 类名映射（实现细节：语义 mark → 样式类，供区域识别用） */
const SYNTAX_CLASSES: Record<string, string> = {
  strong: "milkup-strong",
  emphasis: "milkup-emphasis",
  code_inline: "milkup-code-inline",
  strikethrough: "milkup-strikethrough",
  link: "milkup-link",
  highlight: "milkup-highlight",
  math_inline: "milkup-math-inline",
  heading: "milkup-heading", // 标题
  strong_emphasis: "milkup-strong-emphasis", // 粗斜体
  escape: "milkup-escape", // 转义
  sub: "milkup-sub", // 下标
  sup: "milkup-sup", // 上标
  html_inline: "milkup-html-inline", // 行内 HTML
  html_entity: "milkup-html-entity", // HTML entity
};

/** 语法类型关联映射 - 用于处理嵌套语法 */
const SYNTAX_TYPE_RELATIONS: Record<string, string[]> = {
  strong_emphasis: ["strong", "emphasis"],
  strong: ["strong", "strong_emphasis"],
  emphasis: ["emphasis", "strong_emphasis"],
  highlight: ["highlight"],
  strikethrough: ["strikethrough"],
  code_inline: ["code_inline"],
  link: ["link"],
  math_inline: ["math_inline"],
  heading: ["heading"],
  escape: ["escape"],
  sub: ["sub"],
  sup: ["sup"],
  html_inline: ["html_inline"],
  html_entity: ["html_entity"],
};

/**
 * `findSyntaxMarkerRegions` 的缓存。
 *
 * ProseMirror 的文档节点是不可变的：同一个 doc 实例的扫描结果永远不会变。
 * 而光标修正路径（每次 mouseup、每次 selectionchange）都会调用它做「光标是否落在
 * 隐藏语法标记内」的判断——不缓存就是每次点一下鼠标都全文档遍历好几遍。
 * 以 doc 为 WeakMap 键：文档一变更旧键自然被回收，既不会泄漏也不会读到过期结果。
 *
 * 注意：返回的是共享数组，调用方只读（现有调用方都是 `filter`/`some`，不原地修改）。
 */
const syntaxMarkerRegionCache = new WeakMap<Node, SyntaxMarkerRegion[]>();

/**
 * 查找文档中所有的 syntax_marker 区域
 */
export function findSyntaxMarkerRegions(doc: Node): SyntaxMarkerRegion[] {
  const cached = syntaxMarkerRegionCache.get(doc);
  if (cached) return cached;

  const regions: SyntaxMarkerRegion[] = [];

  doc.descendants((node, pos) => {
    if (node.isText) {
      const syntaxMark = node.marks.find((m) => m.type.name === "syntax_marker");
      if (syntaxMark) {
        regions.push({
          from: pos,
          to: pos + node.nodeSize,
          syntaxType: syntaxMark.attrs.syntaxType,
        });
      }
    }
    return true;
  });

  syntaxMarkerRegionCache.set(doc, regions);
  return regions;
}

/** 行内数学公式区域 */
export interface MathInlineRegion {
  from: number;
  to: number;
  content: string;
  contentFrom: number;
  contentTo: number;
}

/** 行内图片区域：原文即 markdown，mark 上带着渲染所需的属性 */
export interface ImageRegion {
  from: number;
  to: number;
  /** 原文（`![alt](src "title")` 或 `[![alt](src)](href)`） */
  text: string;
  attrs: {
    src: string;
    alt: string;
    title: string;
    linkHref: string;
    linkTitle: string;
  };
}

/**
 * 查找文档中所有行内图片区域（带 image mark 的连续文本）
 */
export function findImageRegions(doc: Node): ImageRegion[] {
  const regions: ImageRegion[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const mark = node.marks.find((m) => m.type.name === "image");
    if (!mark) return true;

    const from = pos;
    const to = pos + node.nodeSize;
    const last = regions[regions.length - 1];

    // 相邻同属性图片文本合并为一个区域（连续图片各是独立 token，不合并）
    if (
      last &&
      last.to === from &&
      last.attrs.src === mark.attrs.src &&
      last.attrs.linkHref === mark.attrs.linkHref
    ) {
      last.to = to;
      last.text += node.text ?? "";
      return true;
    }

    regions.push({
      from,
      to,
      text: node.text ?? "",
      attrs: {
        src: mark.attrs.src,
        alt: mark.attrs.alt,
        title: mark.attrs.title,
        linkHref: mark.attrs.linkHref,
        linkTitle: mark.attrs.linkTitle,
      },
    });
    return true;
  });

  return regions;
}

/** 渲染图片 widget（光标不在语法内时替代原文展示） */
function createImageWidget(region: ImageRegion, view: EditorView): HTMLElement {
  const { attrs } = region;
  const wrap = document.createElement("span");
  wrap.className = "milkup-image";

  // 段落里只有这张图时，按「独占一行 + 居中」呈现
  let $region = null;
  try {
    $region = view.state.doc.resolve(region.from);
  } catch {
    $region = null;
  }
  if ($region && $region.parent.isTextblock) {
    const isSolo = $region.parent.textContent.trim() === region.text.trim();
    wrap.classList.toggle("milkup-image-solo", isSolo);
  }

  const preview = document.createElement("span");
  preview.className = "milkup-image-preview";
  wrap.appendChild(preview);

  // 双击图片：在新窗口查看原图（沿用原块级图片的能力）
  wrap.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!attrs.src) return;
    window.open(resolveImageSrc(attrs.src), "_blank", "noopener,noreferrer");
  });

  if (!attrs.src) {
    const placeholder = document.createElement("span");
    placeholder.className = "milkup-image-placeholder";
    placeholder.textContent = "请输入图片地址";
    preview.appendChild(placeholder);
  } else {
    const img = document.createElement("img");
    img.src = resolveImageSrc(attrs.src);
    img.alt = attrs.alt;
    img.draggable = false;
    if (attrs.title) img.title = attrs.title;
    img.onerror = () => {
      preview.innerHTML = "";
      const error = document.createElement("span");
      error.className = "milkup-image-placeholder milkup-image-error-placeholder";
      error.title = attrs.src;
      error.textContent = "图片加载失败";
      preview.appendChild(error);
    };

    if (attrs.linkHref) {
      const a = document.createElement("a");
      a.href = attrs.linkHref;
      a.addEventListener("click", (e) => e.preventDefault());
      a.appendChild(img);
      preview.appendChild(a);
    } else {
      preview.appendChild(img);
    }
  }

  // 点击图片：光标进入语法内部（原文显形，可直接编辑）
  wrap.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const { state } = view;
    const target = Math.min(region.from + 2, region.to, state.doc.content.size);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(state.doc, target)));
    view.focus();
  });

  return wrap;
}

/**
 * 查找文档中所有的行内数学公式区域
 */
export function findMathInlineRegions(doc: Node): MathInlineRegion[] {
  const regions: MathInlineRegion[] = [];

  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      // 在文本块中查找 math_inline mark 区域
      let offset = pos + 1; // +1 跳过节点开始标记
      let currentRegion: {
        from: number;
        to: number;
        content: string;
        contentFrom: number;
        contentTo: number;
      } | null = null;

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        const childStart = offset;
        const childEnd = offset + child.nodeSize;

        const hasMathMark = child.marks.some((m) => m.type.name === "math_inline");
        const hasSyntaxMark = child.marks.some(
          (m) => m.type.name === "syntax_marker" && m.attrs.syntaxType === "math_inline"
        );

        if (hasMathMark) {
          if (currentRegion === null) {
            currentRegion = {
              from: childStart,
              to: childEnd,
              content: "",
              contentFrom: childStart,
              contentTo: childEnd,
            };
          } else {
            currentRegion.to = childEnd;
          }

          // 如果不是语法标记，则是内容
          if (!hasSyntaxMark && child.isText) {
            if (currentRegion.content === "") {
              currentRegion.contentFrom = childStart;
            }
            currentRegion.content += child.text || "";
            currentRegion.contentTo = childEnd;
          }
        } else {
          if (currentRegion !== null) {
            regions.push(currentRegion);
            currentRegion = null;
          }
        }

        offset = childEnd;
      }

      // 不要忘记最后一个区域
      if (currentRegion !== null) {
        regions.push(currentRegion);
      }
    }
    return true;
  });

  return regions;
}

/**
 * 查找包含指定位置的所有语义 Mark 区域
 * 用于判断光标是否在某个语法结构内
 * 返回所有相关的语义区域（支持嵌套语法）
 */
export function findSemanticRegionsAt(
  doc: Node,
  pos: number
): Array<{ type: string; from: number; to: number }> {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;

  if (!parent.isTextblock) return [];

  // 保存父节点内容的开始位置
  const parentStart = $pos.start();
  let offset = parentStart;
  const regions: Array<{ type: string; from: number; to: number }> = [];
  const foundTypes = new Set<string>();

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childStart = offset;
    const childEnd = offset + child.nodeSize;

    if (pos >= childStart && pos <= childEnd) {
      // 检查这个节点的所有 marks
      for (const mark of child.marks) {
        if (
          mark.type.name !== "syntax_marker" &&
          SYNTAX_CLASSES[mark.type.name] &&
          !foundTypes.has(mark.type.name)
        ) {
          // 找到语义 mark，现在需要找到整个区域
          const region = findFullMarkRegion(parent, mark.type.name, childStart, parentStart);
          if (region) {
            regions.push(region);
            foundTypes.add(mark.type.name);
          }
        }
      }
    }

    offset = childEnd;
  }

  return regions;
}

/**
 * 找到完整的 mark 区域（包括相邻的同类型 mark 节点）
 * 确保找到包含 startHint 位置的连续区域
 */
function findFullMarkRegion(
  parent: Node,
  markType: string,
  startHint: number,
  parentOffset: number
): { type: string; from: number; to: number } | null {
  // 收集所有有该 mark 的连续区域
  const regions: Array<{ from: number; to: number }> = [];
  let currentRegion: { from: number; to: number } | null = null;
  let offset = parentOffset;

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childStart = offset;
    const childEnd = offset + child.nodeSize;

    const hasMark = child.marks.some((m) => m.type.name === markType);

    if (hasMark) {
      if (currentRegion === null) {
        currentRegion = { from: childStart, to: childEnd };
      } else {
        currentRegion.to = childEnd;
      }
    } else {
      if (currentRegion !== null) {
        regions.push(currentRegion);
        currentRegion = null;
      }
    }

    offset = childEnd;
  }

  // 不要忘记最后一个区域
  if (currentRegion !== null) {
    regions.push(currentRegion);
  }

  // 找到包含 startHint 的区域
  for (const region of regions) {
    if (startHint >= region.from && startHint <= region.to) {
      return { type: markType, from: region.from, to: region.to };
    }
  }

  // 如果没找到，返回第一个区域（兜底）
  if (regions.length > 0) {
    return { type: markType, from: regions[0].from, to: regions[0].to };
  }

  return null;
}

/**
 * 获取光标所在的所有语义区域
 * 包括行内 marks 和块级节点（如标题）
 */
export function getActiveSemanticRegions(
  doc: Node,
  cursorPos: number
): Array<{ type: string; from: number; to: number }> {
  const regions: Array<{ type: string; from: number; to: number }> = [];

  // 首先检查行内 mark 区域
  const inlineRegions = findSemanticRegionsAt(doc, cursorPos);
  regions.push(...inlineRegions);

  // 检查块级节点（如标题）
  const $pos = doc.resolve(cursorPos);
  const parent = $pos.parent;

  // 如果父节点是标题，返回整个标题区域
  if (parent.type.name === "heading") {
    const start = $pos.start();
    const end = $pos.end();
    regions.push({ type: "heading", from: start, to: end });
  }

  return regions;
}

/**
 * 光标上下文指纹。
 *
 * `computeDecorations` 只在下面这几处依赖 cursorPos：
 *   ① 光标落在哪些语义区域内（区域内的语法标记要显形）
 *   ② 光标直接压在哪些 syntax_marker 上
 *   ③ 转义标记的 `±1` 特殊规则命中了哪些
 *   ④ 光标落在哪些行内公式 / 图片区域内
 * 把这些「判定结果」压成指纹：指纹相同 ⇒ 重算的装饰集必然逐项相同，可以整块复用。
 *
 * 只做整数比较、只对命中的条目拼字符串，不做任何对象分配——比重新构造一遍
 * Decoration 对象再 `DecorationSet.create` 便宜一个量级。
 */
function computeCursorKey(
  doc: Node,
  cursorPos: number,
  syntaxRegions: SyntaxMarkerRegion[],
  mathRegions: MathInlineRegion[],
  imageRegions: ImageRegion[],
  sourceView: boolean
): string {
  const semantic = getActiveSemanticRegions(doc, cursorPos)
    .map((region) => `${region.type}:${region.from}-${region.to}`)
    .join(",");

  let markers = "";
  let escapes = "";
  for (let i = 0; i < syntaxRegions.length; i++) {
    const region = syntaxRegions[i];
    if (cursorPos >= region.from && cursorPos <= region.to) markers += `${i},`;
    if (region.syntaxType === "escape" && cursorPos >= region.from && cursorPos <= region.to + 1) {
      escapes += `${i},`;
    }
  }

  let math = "";
  for (let i = 0; i < mathRegions.length; i++) {
    const region = mathRegions[i];
    if (cursorPos >= region.from && cursorPos <= region.to) math += `${i},`;
  }

  let images = "";
  for (let i = 0; i < imageRegions.length; i++) {
    const region = imageRegions[i];
    if (cursorPos >= region.from && cursorPos <= region.to) images += `${i},`;
  }

  return `${sourceView ? 1 : 0}|${semantic}|${markers}|${escapes}|${math}|${images}`;
}

/**
 * 检查语法类型是否与语义区域类型相关
 */
function isSyntaxTypeRelated(syntaxType: string, semanticType: string): boolean {
  const relatedTypes = SYNTAX_TYPE_RELATIONS[syntaxType] || [syntaxType];
  return relatedTypes.includes(semanticType);
}

/**
 * 计算装饰集（实现细节：对外只暴露 `createDecorationPlugin`）
 */
function computeDecorations(
  doc: Node,
  cursorPos: number,
  sourceView: boolean,
  precomputedSyntaxRegions?: SyntaxMarkerRegion[],
  precomputedMathRegions?: MathInlineRegion[],
  precomputedImageRegions?: ImageRegion[]
): {
  decorations: DecorationSet;
  activeRegions: SyntaxMarkerRegion[];
  syntaxRegions: SyntaxMarkerRegion[];
  mathInlineRegions: MathInlineRegion[];
  imageRegions: ImageRegion[];
} {
  // 源码模式下跳过所有装饰计算：
  // - 语法标记通过 .milkup-syntax-marker 类（mark 自带）已有正确样式
  // - 无需 hidden/visible 装饰切换
  // - 无需行内数学公式渲染 widget
  if (sourceView) {
    return {
      decorations: DecorationSet.empty,
      activeRegions: [],
      syntaxRegions: precomputedSyntaxRegions ?? [],
      mathInlineRegions: precomputedMathRegions ?? [],
      imageRegions: precomputedImageRegions ?? [],
    };
  }

  const syntaxRegions = precomputedSyntaxRegions ?? findSyntaxMarkerRegions(doc);
  const mathInlineRegions = precomputedMathRegions ?? findMathInlineRegions(doc);
  const imageRegions = precomputedImageRegions ?? findImageRegions(doc);
  const decorations: Decoration[] = [];

  // 获取光标所在的所有语义区域
  const activeSemanticRegions = getActiveSemanticRegions(doc, cursorPos);

  for (const region of syntaxRegions) {
    // 判断这个语法标记是否应该显示
    let shouldShow: boolean = sourceView;

    if (!shouldShow && region.syntaxType === "escape") {
      // escape 类型特殊处理：当光标在 `\` 或紧邻的被转义字符上时显示
      // region 是 `\` 的位置，被转义字符紧跟其后（region.to 位置）
      if (cursorPos >= region.from && cursorPos <= region.to + 1) {
        shouldShow = true;
      }
    } else if (!shouldShow && activeSemanticRegions.length > 0) {
      // 如果光标在某个语义区域内，显示该区域的所有语法标记
      for (const activeRegion of activeSemanticRegions) {
        // 检查这个 syntax_marker 是否属于当前活跃的语义区域
        if (isSyntaxTypeRelated(region.syntaxType, activeRegion.type)) {
          // 检查位置是否在语义区域内（严格检查）
          if (region.from >= activeRegion.from && region.to <= activeRegion.to) {
            shouldShow = true;
            break;
          }
        }
      }
    }

    if (!shouldShow) {
      // 检查光标是否直接在这个 syntax_marker 内
      if (cursorPos >= region.from && cursorPos <= region.to) {
        shouldShow = true;
      }
    }

    if (!shouldShow) {
      // 隐藏语法标记
      if (region.syntaxType === "heading") {
        // 标题语法标记特殊处理：只隐藏 # 字符，保留尾部空格可见
        const text = doc.textBetween(region.from, region.to);
        const hashEnd = text.search(/[^#]/);
        if (hashEnd > 0 && hashEnd < text.length) {
          decorations.push(
            Decoration.inline(region.from, region.from + hashEnd, {
              class: "milkup-syntax-hidden",
              contenteditable: "false",
              "aria-hidden": "true",
            })
          );
        } else {
          decorations.push(
            Decoration.inline(region.from, region.to, {
              class: "milkup-syntax-hidden",
              contenteditable: "false",
              "aria-hidden": "true",
            })
          );
        }
      } else if (region.syntaxType === HTML_ENTITY_SYNTAX_TYPE) {
        const entityText = doc.textBetween(region.from, region.to);
        const decoded = decodeHtmlEntity(entityText);
        if (decoded) {
          decorations.push(
            Decoration.inline(region.from, region.to, {
              class: "milkup-syntax-hidden",
              contenteditable: "false",
              "aria-hidden": "true",
            })
          );

          const widget = document.createElement("span");
          widget.className = "milkup-html-entity-rendered";
          widget.textContent = decoded;
          decorations.push(Decoration.widget(region.to, widget, { side: -1 }));
        } else {
          decorations.push(
            Decoration.inline(region.from, region.to, {
              class: "milkup-syntax-visible",
            })
          );
        }
      } else {
        decorations.push(
          Decoration.inline(region.from, region.to, {
            class: "milkup-syntax-hidden",
            contenteditable: "false",
            "aria-hidden": "true",
          })
        );
      }
    } else {
      // 显示语法标记
      decorations.push(
        Decoration.inline(region.from, region.to, {
          class: "milkup-syntax-visible",
        })
      );
    }
  }

  // 为行内数学公式添加渲染装饰
  for (const mathRegion of mathInlineRegions) {
    // 检查光标是否在这个数学公式区域内
    const cursorInMath = cursorPos >= mathRegion.from && cursorPos <= mathRegion.to;

    if (!cursorInMath && !sourceView && mathRegion.content.trim()) {
      // 光标不在公式内，隐藏源码并显示渲染结果
      // 隐藏整个公式源码
      decorations.push(
        Decoration.inline(mathRegion.from, mathRegion.to, {
          class: "milkup-math-source-hidden",
        })
      );

      // 在公式后面添加渲染后的 widget
      const renderedHtml = renderInlineMath(mathRegion.content);
      if (renderedHtml) {
        const widget = document.createElement("span");
        widget.className = "milkup-math-rendered";
        widget.innerHTML = renderedHtml;
        decorations.push(Decoration.widget(mathRegion.to, widget, { side: -1 }));
      }
    }
  }

  // 行内图片：原文按光标位置显隐，图片本身始终渲染
  // （编辑语法时也能看到图片，与块级图片时代的「源码与预览同时显示」一致）
  for (const imageRegion of imageRegions) {
    const cursorInImage = cursorPos >= imageRegion.from && cursorPos <= imageRegion.to;

    if (cursorInImage) {
      // 显示原文（样式与其它行内语法一致）
      decorations.push(
        Decoration.inline(imageRegion.from, imageRegion.to, {
          class: "milkup-syntax-visible",
        })
      );
    } else {
      decorations.push(
        Decoration.inline(imageRegion.from, imageRegion.to, {
          class: "milkup-syntax-hidden",
          contenteditable: "false",
          "aria-hidden": "true",
        })
      );
    }

    decorations.push(
      Decoration.widget(imageRegion.to, (view) => createImageWidget(imageRegion, view), {
        key: `image-${imageRegion.from}-${imageRegion.to}-${imageRegion.attrs.src}`,
        side: -1,
      })
    );
  }

  return {
    decorations: DecorationSet.create(doc, decorations),
    activeRegions: syntaxRegions.filter((r) => cursorPos >= r.from && cursorPos <= r.to),
    syntaxRegions,
    mathInlineRegions,
    imageRegions,
  };
}

/**
 * 创建装饰插件
 */
export function createDecorationPlugin(initialSourceView = false): Plugin<DecorationPluginState> {
  return new Plugin<DecorationPluginState>({
    key: decorationPluginKey,

    state: {
      init(_, state) {
        const {
          decorations,
          activeRegions,
          syntaxRegions,
          mathInlineRegions,
          imageRegions,
        } = computeDecorations(state.doc, state.selection.head, initialSourceView);
        return {
          decorations,
          activeRegions,
          sourceView: initialSourceView,
          cachedSyntaxRegions: syntaxRegions,
          cachedMathInlineRegions: mathInlineRegions,
          cachedImageRegions: imageRegions,
          cursorKey: computeCursorKey(
            state.doc,
            state.selection.head,
            syntaxRegions,
            mathInlineRegions,
            imageRegions,
            initialSourceView
          ),
        };
      },

      apply(tr, pluginState, oldState, newState) {
        const selectionChanged = !oldState.selection.eq(newState.selection);
        const docChanged = tr.docChanged;

        const meta = tr.getMeta(decorationPluginKey);
        const sourceView = meta?.sourceView ?? pluginState.sourceView;
        const sourceViewChanged = meta?.sourceView !== undefined;

        // 纯选区变化：先算「光标上下文」指纹，指纹没变就整块复用上一次的装饰集。
        // 打字时的光标移动大多落在同一个语义区域内，这条快路径能省掉
        // 每次方向键都重建 N 个 Decoration 并重排 DecorationSet。
        if (!docChanged && !sourceViewChanged) {
          if (!selectionChanged) return pluginState;

          const cursorKey = computeCursorKey(
            newState.doc,
            newState.selection.head,
            pluginState.cachedSyntaxRegions,
            pluginState.cachedMathInlineRegions,
            pluginState.cachedImageRegions,
            sourceView
          );
          if (cursorKey === pluginState.cursorKey) return pluginState;

          const {
            decorations,
            activeRegions,
            syntaxRegions,
            mathInlineRegions,
            imageRegions,
          } = computeDecorations(
            newState.doc,
            newState.selection.head,
            sourceView,
            pluginState.cachedSyntaxRegions,
            pluginState.cachedMathInlineRegions,
            pluginState.cachedImageRegions
          );
          return {
            decorations,
            activeRegions,
            sourceView,
            cachedSyntaxRegions: syntaxRegions,
            cachedMathInlineRegions: mathInlineRegions,
            cachedImageRegions: imageRegions,
            cursorKey,
          };
        }

        if (docChanged || sourceViewChanged) {
          // 仅在文档变化或源码模式切换时重新扫描区域，选区变化时复用缓存
          const needRescan = docChanged || sourceViewChanged;
          const syntaxRegions = needRescan ? undefined : pluginState.cachedSyntaxRegions;
          const mathRegions = needRescan ? undefined : pluginState.cachedMathInlineRegions;
          const imageRegions = needRescan ? undefined : pluginState.cachedImageRegions;

          const computed = computeDecorations(
            newState.doc,
            newState.selection.head,
            sourceView,
            syntaxRegions,
            mathRegions,
            imageRegions
          );
          return {
            decorations: computed.decorations,
            activeRegions: computed.activeRegions,
            sourceView,
            cachedSyntaxRegions: computed.syntaxRegions,
            cachedMathInlineRegions: computed.mathInlineRegions,
            cachedImageRegions: computed.imageRegions,
            cursorKey: computeCursorKey(
              newState.doc,
              newState.selection.head,
              computed.syntaxRegions,
              computed.mathInlineRegions,
              computed.imageRegions,
              sourceView
            ),
          };
        }

        return pluginState;
      },
    },

    props: {
      decorations(state) {
        return this.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },

    /**
     * 源码视图状态 → NodeView 订阅者的推送。
     *
     * 走 plugin state 而不是在 `setSourceView/toggleSourceView` 里手动通知：
     * 前者是唯一真相，无论从哪条路径改变（快捷键、config、初始值）都能覆盖到，
     * 也不会漏掉某个调用点。并且按 view 推送，不再跨编辑器广播。
     */
    view(view) {
      let current = decorationPluginKey.getState(view.state)?.sourceView ?? initialSourceView;
      // 先记下当前值：此后创建的 NodeView 订阅时能立刻拿到正确状态
      sourceViewRegistry.setState(view, current);

      return {
        update(updatedView) {
          const next = decorationPluginKey.getState(updatedView.state)?.sourceView ?? false;
          if (next === current) return;
          current = next;
          sourceViewRegistry.setState(updatedView, next);
        },
      };
    },
  });
}

/**
 * 切换源码视图
 */
export function toggleSourceView(
  state: EditorState,
  dispatch?: (tr: any) => void,
  view?: EditorView
): boolean {
  const pluginState = decorationPluginKey.getState(state);
  if (!pluginState) return false;

  const newSourceView = !pluginState.sourceView;
  const selectionViewportOffset = view ? getSelectionViewportOffset(view) : null;

  if (dispatch) {
    const tr = state.tr
      .setMeta(decorationPluginKey, {
        sourceView: newSourceView,
      })
      .setMeta(sourceViewTransformAppliedMeta, true)
      .setMeta("addToHistory", false);

    // 文档里没有需要转换的块时（纯文本 / 纯行内语法文档）直接翻状态：
    // 不插哨兵、不替换文档，于是不会有 docChanged，也就不会触发全量序列化与
    // 整段 DOM 重建——这是源码视图切换里最便宜的一条路径。
    if (needsSourceViewConversion(state.doc, newSourceView)) {
      const cursorMarker = addSourceViewCursorMarker(tr, state, pluginState.sourceView);
      // 将文档转换合并到同一个 transaction 中，避免 appendTransaction 产生第二轮插件应用
      if (newSourceView) {
        convertBlocksToParagraphs(tr);
      } else {
        convertParagraphsToBlocks(tr);
      }
      restoreSourceViewCursorMarker(tr, cursorMarker);
    }

    dispatch(selectionViewportOffset === null ? tr.scrollIntoView() : tr);
  }

  if (dispatch && view && selectionViewportOffset !== null) {
    restoreSelectionViewportOffset(view, selectionViewportOffset);
  }

  return true;
}

/**
 * 设置源码视图状态
 */
export function setSourceView(
  state: EditorState,
  enabled: boolean,
  dispatch?: (tr: any) => void
): boolean {
  if (dispatch) {
    const tr = state.tr
      .setMeta(decorationPluginKey, { sourceView: enabled })
      .setMeta("addToHistory", false);
    dispatch(tr);
  }

  return true;
}
