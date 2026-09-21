/**
 * Milkup 源码模式文档转换插件
 *
 * 在源码模式下将块级元素（代码块、图片、分割线）拆分/转换为段落节点
 * 在退出源码模式时将段落节点重新组合为对应的块级元素
 */

import { Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Node as ProseMirrorNode, Schema, Fragment } from "prosemirror-model";
import { decorationPluginKey } from "../decorations";
import { parseMarkdown } from "../parser";
import { MarkdownSerializer } from "../serializer";

/**
 * 把转换结果落成「只替换真正变化的区间」。
 *
 * 早期实现是 `new ReplaceStep(0, doc.content.size, …)`——整篇替换。代价有三层，
 * 而且都指向光标/滚动这类体验问题：
 *   1. 整篇替换的 StepMap 会把选区塌缩成一个点，ProseMirror 自己的 position mapping
 *      在这里失效，于是上层不得不用哨兵字符插进文档再「找回」光标；
 *   2. 视图层会重建整个编辑器 DOM，浏览器随之丢掉滚动位置，于是又需要反复补偿 scrollTop；
 *   3. 即使内容其实没变（例如文档里本来就没有可转换的块），也会产生一次 docChanged，
 *      白白触发全量序列化与重渲染。
 *
 * 用 `Fragment.findDiffStart / findDiffEnd` 求出共同的前缀与后缀后只替换中间那段：
 * 前后缀节点原样保留，落在其中的选区被精确平移，内容没变时干脆一个 step 都不产生。
 */
function applyConvertedContent(tr: Transaction, newContent: ProseMirrorNode[]): void {
  if (newContent.length === 0) return;

  const oldFragment = tr.doc.content;
  const newFragment = Fragment.from(newContent);

  const diffStart = oldFragment.findDiffStart(newFragment);
  if (diffStart === null) return; // 内容完全一致：不产生任何变更

  const diffEnd = oldFragment.findDiffEnd(newFragment);
  if (!diffEnd) return;

  tr.replaceWith(diffStart, diffEnd.a, newFragment.cut(diffStart, diffEnd.b));
}

/** 进入源码视图时需要拆成段落的块级节点 */
const CONVERTIBLE_BLOCKS = new Set([
  "code_block",
  "horizontal_rule",
  "table",
  "html_block",
  "math_block",
  "bullet_list",
  "ordered_list",
  "task_list",
  "blockquote",
]);

/** 源码视图里「由块转换而来」的段落属性（退出时需要合回块） */
const SOURCE_PARAGRAPH_ATTRS = [
  "codeBlockId",
  "tableId",
  "htmlBlockId",
  "mathBlockId",
  "listId",
  "blockquoteId",
  "hrSource",
  "blockquoteSeparator",
] as const;

/**
 * 文档里是否存在「本次切换需要转换的内容」。
 *
 * 没有的话就没必要插哨兵字符、也没必要替换任何东西：直接翻一下源码模式状态即可。
 * 否则一次纯文本文档的源码视图切换也会产生 docChanged，触发一次全量序列化
 * 与整段 DOM 重建（也就是说，白干两件最贵的事）。
 */
export function needsSourceViewConversion(doc: ProseMirrorNode, toSourceView: boolean): boolean {
  let needed = false;

  doc.descendants((node) => {
    if (needed) return false;

    if (toSourceView) {
      if (CONVERTIBLE_BLOCKS.has(node.type.name)) {
        needed = true;
        return false;
      }
      return true;
    }

    if (node.type.name === "paragraph") {
      if (SOURCE_PARAGRAPH_ATTRS.some((attr) => Boolean(node.attrs[attr]))) needed = true;
      // 段落内部没有可转换的块级节点，不必继续下探
      return false;
    }
    return true;
  });

  return needed;
}

/** 插件 Key */
export const sourceViewTransformPluginKey = new PluginKey("milkup-source-view-transform");
export const sourceViewTransformAppliedMeta = "milkup-source-view-transform-applied";

/**
 * 生成唯一的代码块 ID
 */
function generateCodeBlockId(): string {
  return `cb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 生成唯一的 HTML 块 ID
 */
function generateHtmlBlockId(): string {
  return `hb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 将代码块转换为多个段落节点
 */
function transformCodeBlockToParagraphs(
  codeBlock: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode[] {
  const language = codeBlock.attrs.language || "";
  let content = codeBlock.textContent;
  const codeBlockId = generateCodeBlockId();

  // 移除内容末尾的换行符，避免产生多余的空行
  // 但保留内容中间的空行
  content = content.replace(/\n+$/, "");

  // 构建完整的 Markdown 代码块文本
  const fullMarkdown = `\`\`\`${language}\n${content}\n\`\`\``;
  const lines = fullMarkdown.split("\n");

  // 为每一行创建一个段落节点
  const paragraphs: ProseMirrorNode[] = [];
  lines.forEach((line, index) => {
    // 为空行也创建段落，但内容为空
    const textContent = line.length > 0 ? schema.text(line) : undefined;
    const paragraph = schema.nodes.paragraph.create(
      {
        codeBlockId,
        lineIndex: index,
        totalLines: lines.length,
        language,
      },
      textContent
    );
    paragraphs.push(paragraph);
  });

  return paragraphs;
}

/**
 * 将连续的代码块段落节点重新组合成代码块
 */
function transformParagraphsToCodeBlock(
  paragraphs: Array<{ node: ProseMirrorNode; pos: number }>,
  schema: Schema
): { codeBlock: ProseMirrorNode; language: string } | null {
  if (paragraphs.length === 0) return null;

  // 提取所有行的文本
  const lines = paragraphs.map((p) => p.node.textContent);

  // 验证是否是完整的代码块格式
  const fullText = lines.join("\n");
  const fenceMatch = fullText.match(/^```([^\n]*?)\n([\s\S]*?)\n```$/);

  if (!fenceMatch) {
    // 不是完整的代码块格式，返回 null
    return null;
  }

  const [, lang, content] = fenceMatch;

  // 创建代码块节点
  const codeBlock = schema.nodes.code_block.create(
    { language: lang || "" },
    content ? schema.text(content) : null
  );

  return { codeBlock, language: lang || "" };
}

/*
 * 图片不需要任何源码模式转换：图片是「mark + 真实文本」，
 * 语法原样躺在段落里，进入/退出源码模式天然正确。
 */

/**
 * 将分割线节点转换为段落节点
 */
function transformHrToParagraph(_hr: ProseMirrorNode, schema: Schema): ProseMirrorNode {
  return schema.nodes.paragraph.create({ hrSource: true }, schema.text("---"));
}

/**
 * 将分割线段落节点转换回分割线节点
 */
function transformParagraphToHr(
  paragraph: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode | null {
  if (!paragraph.attrs.hrSource) return null;

  // 检查文本是否仍然是有效的分割线语法
  const text = paragraph.textContent.trim();
  if (/^[-*_]{3,}$/.test(text)) {
    return schema.nodes.horizontal_rule.create();
  }

  // 文本不再是有效的分割线语法，不转换回分割线
  return null;
}

/**
 * 生成唯一的表格 ID
 */
function generateTableId(): string {
  return `tb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 将表格节点转换为多个段落节点
 */
function transformTableToParagraphs(table: ProseMirrorNode, schema: Schema): ProseMirrorNode[] {
  const tableId = generateTableId();
  const lines: string[] = [];
  const alignments: (string | null)[] = [];
  const serializer = new MarkdownSerializer({ compact: true });

  table.content.forEach((row, _, rowIndex) => {
    const cells: string[] = [];
    row.content.forEach((cell) => {
      cells.push(serializer.serializeTableCellInline(cell));
      if (rowIndex === 0) {
        alignments.push(cell.attrs.align || null);
      }
    });

    lines.push("| " + cells.join(" | ") + " |");

    // 在表头行后添加分隔行
    if (rowIndex === 0) {
      const separators = alignments.map((align) => {
        if (align === "center") return ":---:";
        if (align === "right") return "---:";
        if (align === "left") return ":---";
        return "---";
      });
      lines.push("| " + separators.join(" | ") + " |");
    }
  });

  const paragraphs: ProseMirrorNode[] = [];
  lines.forEach((line, index) => {
    const paragraph = schema.nodes.paragraph.create(
      {
        tableId,
        tableRowIndex: index,
        tableTotalRows: lines.length,
      },
      schema.text(line)
    );
    paragraphs.push(paragraph);
  });

  return paragraphs;
}

/**
 * 将连续的表格段落节点重新组合成表格
 */
function transformParagraphsToTable(
  paragraphs: Array<{ node: ProseMirrorNode; pos: number }>,
  schema: Schema
): ProseMirrorNode | null {
  if (paragraphs.length < 2) return null;

  const lines = paragraphs.map((p) => p.node.textContent);
  if (!isCompleteMarkdownTable(lines)) return null;

  const tableMarkdown = lines.join("\n");

  // 使用解析器重新解析表格
  const result = parseMarkdown(tableMarkdown);
  let tableNode: ProseMirrorNode | null = null;
  let nodeCount = 0;

  result.doc.forEach((node) => {
    nodeCount++;
    if (node.type.name === "table" && !tableNode) {
      tableNode = node;
    }
  });

  return nodeCount === 1 ? tableNode : null;
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
  const separatorColumnCount = lines[1].trimEnd().slice(1, -1).split("|").length;
  if (separatorColumnCount !== expectedColumnCount) return false;

  for (let index = 2; index < lines.length; index++) {
    const line = lines[index];
    if (!tableRowPattern.test(line)) return false;
    const columnCount = line.trimEnd().slice(1, -1).split("|").length;
    if (columnCount !== expectedColumnCount) return false;
  }

  return true;
}

function stripTableParagraphAttrs(node: ProseMirrorNode): ProseMirrorNode {
  if (node.type.name !== "paragraph" || !node.attrs.tableId) return node;
  return node.type.create(
    {
      ...node.attrs,
      tableId: null,
      tableRowIndex: null,
      tableTotalRows: null,
    },
    node.content,
    node.marks
  );
}

function isMarkdownTableCandidateLine(node: ProseMirrorNode): boolean {
  return node.type.name === "paragraph" && node.textContent.trimStart().startsWith("|");
}

function transformMarkdownTableCandidateGroup(
  group: ProseMirrorNode[],
  schema: Schema
): ProseMirrorNode[] {
  if (group.length === 0) return [];
  if (group.length < 3) return group;
  const paragraphs = group.map((node) => ({ node, pos: 0 }));
  const result = transformParagraphsToTable(paragraphs, schema);
  return result ? [result] : group;
}

/**
 * 将 HTML 块节点转换为多个段落节点
 */
function transformHtmlBlockToParagraphs(
  htmlBlock: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode[] {
  const htmlBlockId = generateHtmlBlockId();
  let content = htmlBlock.textContent;
  content = content.replace(/\n+$/, "");
  const lines = content.split("\n");

  const paragraphs: ProseMirrorNode[] = [];
  lines.forEach((line, index) => {
    const textContent = line.length > 0 ? schema.text(line) : undefined;
    const paragraph = schema.nodes.paragraph.create(
      {
        htmlBlockId,
        htmlBlockLineIndex: index,
        htmlBlockTotalLines: lines.length,
      },
      textContent
    );
    paragraphs.push(paragraph);
  });

  return paragraphs;
}

/**
 * 将连续的 HTML 块段落节点重新组合成 HTML 块
 */
function transformParagraphsToHtmlBlock(
  paragraphs: Array<{ node: ProseMirrorNode; pos: number }>,
  schema: Schema
): ProseMirrorNode | null {
  if (paragraphs.length === 0) return null;

  const lines = paragraphs.map((p) => p.node.textContent);
  const content = lines.join("\n");

  // 验证内容是否以 HTML 标签开头
  const tagMatch = content.match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
  if (!tagMatch) return null;

  // 行内标签不应恢复为 html_block
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
  if (inlineElements.has(tagMatch[1].toLowerCase())) return null;

  return schema.nodes.html_block.create({}, content ? schema.text(content) : null);
}

/**
 * 生成唯一的数学公式块 ID
 */
function generateMathBlockId(): string {
  return `mb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 将数学公式块转换为多个段落节点
 */
function transformMathBlockToParagraphs(
  mathBlock: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode[] {
  let content = mathBlock.textContent;
  const mathBlockId = generateMathBlockId();

  // 移除内容末尾的换行符
  content = content.replace(/\n+$/, "");

  // 构建完整的 Markdown 数学公式块文本
  const fullMarkdown = `$$\n${content}\n$$`;
  const lines = fullMarkdown.split("\n");

  const paragraphs: ProseMirrorNode[] = [];
  lines.forEach((line, index) => {
    const textContent = line.length > 0 ? schema.text(line) : undefined;
    const paragraph = schema.nodes.paragraph.create(
      {
        mathBlockId,
        mathBlockLineIndex: index,
        mathBlockTotalLines: lines.length,
      },
      textContent
    );
    paragraphs.push(paragraph);
  });

  return paragraphs;
}

/**
 * 将连续的数学公式块段落节点重新组合成数学公式块
 */
function transformParagraphsToMathBlock(
  paragraphs: Array<{ node: ProseMirrorNode; pos: number }>,
  schema: Schema
): ProseMirrorNode | null {
  if (paragraphs.length === 0) return null;

  const lines = paragraphs.map((p) => p.node.textContent);
  const fullText = lines.join("\n");
  const mathMatch = fullText.match(/^\$\$\n([\s\S]*?)\n\$\$$/);

  if (!mathMatch) return null;

  const [, content] = mathMatch;
  return schema.nodes.math_block.create(
    { language: "latex" },
    content ? schema.text(content) : null
  );
}

/**
 * 生成唯一的列表 ID
 */
function generateListId(): string {
  return `li_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 生成唯一的引用块 ID
 */
function generateBlockquoteId(): string {
  return `bq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 将列表节点转换为多个段落节点
 */
function transformListToParagraphs(list: ProseMirrorNode, schema: Schema): ProseMirrorNode[] {
  const listId = generateListId();

  // 使用序列化器将列表转换为 Markdown 文本
  const serializer = new MarkdownSerializer({ compact: true });
  const tempDoc = schema.nodes.doc.create(null, [list]);
  const markdown = serializer.serialize(tempDoc);

  // 移除末尾换行符
  const content = markdown.replace(/\n+$/, "");
  const lines = content.split("\n");

  const paragraphs: ProseMirrorNode[] = [];
  lines.forEach((line, index) => {
    const textContent = line.length > 0 ? schema.text(line) : undefined;
    const paragraph = schema.nodes.paragraph.create(
      {
        listId,
        listLineIndex: index,
        listTotalLines: lines.length,
      },
      textContent
    );
    paragraphs.push(paragraph);
  });

  return paragraphs;
}

/**
 * 将连续的列表段落节点重新组合成列表
 */
function transformParagraphsToList(
  paragraphs: Array<{ node: ProseMirrorNode; pos: number }>,
  schema: Schema
): ProseMirrorNode[] | null {
  if (paragraphs.length === 0) return null;

  const lines = paragraphs.map((p) => p.node.textContent);
  const listMarkdown = lines.join("\n");

  // 使用解析器重新解析列表
  const result = parseMarkdown(listMarkdown);
  const nodes: ProseMirrorNode[] = [];

  result.doc.forEach((node) => {
    nodes.push(node);
  });

  return nodes.length > 0 ? nodes : null;
}

/**
 * 将引用块节点转换为多个段落节点
 */
function transformBlockquoteToParagraphs(
  blockquote: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode[] {
  const blockquoteId = generateBlockquoteId();
  const serializer = new MarkdownSerializer({ compact: true });
  const tempDoc = schema.nodes.doc.create(null, [blockquote]);
  const markdown = serializer.serialize(tempDoc);
  const content = markdown.replace(/\n+$/, "");
  const lines = content.split("\n");

  return lines.map((line, index) =>
    schema.nodes.paragraph.create(
      {
        blockquoteId,
        blockquoteLineIndex: index,
        blockquoteTotalLines: lines.length,
      },
      line.length > 0 ? schema.text(line) : undefined
    )
  );
}

/**
 * 将连续的引用块段落节点重新组合成引用块
 */
function transformParagraphsToBlockquote(
  paragraphs: Array<{ node: ProseMirrorNode; pos: number }>,
  _schema: Schema
): ProseMirrorNode[] | null {
  if (paragraphs.length === 0) return null;

  const lines = paragraphs.map((p) => p.node.textContent);
  const blockquoteMarkdown = lines.join("\n");
  const result = parseMarkdown(blockquoteMarkdown);
  const nodes: ProseMirrorNode[] = [];

  result.doc.forEach((node) => {
    nodes.push(node);
  });

  return nodes.length > 0 ? nodes : null;
}

function createBlockquoteSeparatorParagraph(schema: Schema): ProseMirrorNode {
  return schema.nodes.paragraph.create({ blockquoteSeparator: true });
}

/**
 * 递归处理节点，将块级元素转换为段落（用于进入源码模式）
 */
function processNodeForSourceConversion(
  node: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode | ProseMirrorNode[] {
  if (node.type.name === "code_block") {
    return transformCodeBlockToParagraphs(node, schema);
  }

  if (node.type.name === "horizontal_rule") {
    return [transformHrToParagraph(node, schema)];
  } else if (node.type.name === "table") {
    return transformTableToParagraphs(node, schema);
  } else if (node.type.name === "html_block") {
    return transformHtmlBlockToParagraphs(node, schema);
  } else if (node.type.name === "math_block") {
    return transformMathBlockToParagraphs(node, schema);
  } else if (
    node.type.name === "bullet_list" ||
    node.type.name === "ordered_list" ||
    node.type.name === "task_list"
  ) {
    return transformListToParagraphs(node, schema);
  } else if (node.type.name === "blockquote") {
    return transformBlockquoteToParagraphs(node, schema);
  }

  // 递归处理子节点
  if (node.content.size > 0) {
    const newChildren: ProseMirrorNode[] = [];
    let changed = false;

    node.content.forEach((child) => {
      const processed = processNodeForSourceConversion(child, schema);
      if (Array.isArray(processed)) {
        newChildren.push(...processed);
        changed = true;
      } else if (processed !== child) {
        newChildren.push(processed);
        changed = true;
      } else {
        newChildren.push(child);
      }
    });

    if (changed) {
      return node.type.create(node.attrs, Fragment.from(newChildren), node.marks);
    }
  }

  return node;
}

/**
 * 将文档中的所有块级元素（代码块、图片、分割线、表格、HTML块）转换为段落
 * 使用整体替换文档内容的方式（单次 ReplaceStep），避免逐个节点操作的 O(N²) 开销
 */
export function convertBlocksToParagraphs(tr: Transaction): Transaction {
  const doc = tr.doc;
  const schema = doc.type.schema;
  const newContent: ProseMirrorNode[] = [];
  let changed = false;

  doc.forEach((node, _, index) => {
    const processed = processNodeForSourceConversion(node, schema);
    if (Array.isArray(processed)) {
      newContent.push(...processed);
      changed = true;
    } else {
      newContent.push(processed);
      if (processed !== node) changed = true;
    }

    const nextNode = index + 1 < doc.childCount ? doc.child(index + 1) : null;
    if (node.type.name === "blockquote" && nextNode?.type.name === "blockquote") {
      newContent.push(createBlockquoteSeparatorParagraph(schema));
      changed = true;
    }
  });

  if (changed) applyConvertedContent(tr, newContent);

  return tr;
}

/**
 * 递归处理节点，转换代码块段落
 */
function processNodeForBlockConversion(
  node: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode | ProseMirrorNode[] {
  // 如果节点有子节点，递归处理
  if (node.content.size > 0) {
    const newChildren: ProseMirrorNode[] = [];
    let codeBlockGroup: ProseMirrorNode[] = [];
    let currentCodeBlockId: string | null = null;
    let tableGroup: ProseMirrorNode[] = [];
    let currentTableId: string | null = null;
    let htmlBlockGroup: ProseMirrorNode[] = [];
    let currentHtmlBlockId: string | null = null;
    let mathBlockGroup: ProseMirrorNode[] = [];
    let currentMathBlockId: string | null = null;
    let listGroup: ProseMirrorNode[] = [];
    let currentListId: string | null = null;
    let blockquoteGroup: ProseMirrorNode[] = [];
    let currentBlockquoteId: string | null = null;
    let markdownTableCandidateGroup: ProseMirrorNode[] = [];

    const flushCodeBlockGroup = () => {
      if (codeBlockGroup.length === 0) return;
      const paragraphs = codeBlockGroup.map((n) => ({ node: n, pos: 0 }));
      const result = transformParagraphsToCodeBlock(paragraphs, schema);
      if (result) {
        newChildren.push(result.codeBlock);
      } else {
        newChildren.push(...codeBlockGroup);
      }
      codeBlockGroup = [];
      currentCodeBlockId = null;
    };

    const flushTableGroup = () => {
      if (tableGroup.length === 0) return;
      const paragraphs = tableGroup.map((n) => ({ node: n, pos: 0 }));
      const result = transformParagraphsToTable(paragraphs, schema);
      if (result) {
        newChildren.push(result);
      } else {
        newChildren.push(...tableGroup.map(stripTableParagraphAttrs));
      }
      tableGroup = [];
      currentTableId = null;
    };

    const flushHtmlBlockGroup = () => {
      if (htmlBlockGroup.length === 0) return;
      const paragraphs = htmlBlockGroup.map((n) => ({ node: n, pos: 0 }));
      const result = transformParagraphsToHtmlBlock(paragraphs, schema);
      if (result) {
        newChildren.push(result);
      } else {
        newChildren.push(...htmlBlockGroup);
      }
      htmlBlockGroup = [];
      currentHtmlBlockId = null;
    };

    const flushMathBlockGroup = () => {
      if (mathBlockGroup.length === 0) return;
      const paragraphs = mathBlockGroup.map((n) => ({ node: n, pos: 0 }));
      const result = transformParagraphsToMathBlock(paragraphs, schema);
      if (result) {
        newChildren.push(result);
      } else {
        newChildren.push(...mathBlockGroup);
      }
      mathBlockGroup = [];
      currentMathBlockId = null;
    };

    const flushListGroup = () => {
      if (listGroup.length === 0) return;
      const paragraphs = listGroup.map((n) => ({ node: n, pos: 0 }));
      const result = transformParagraphsToList(paragraphs, schema);
      if (result) {
        newChildren.push(...result);
      } else {
        newChildren.push(...listGroup);
      }
      listGroup = [];
      currentListId = null;
    };

    const flushBlockquoteGroup = () => {
      if (blockquoteGroup.length === 0) return;
      const paragraphs = blockquoteGroup.map((n) => ({ node: n, pos: 0 }));
      const result = transformParagraphsToBlockquote(paragraphs, schema);
      if (result) {
        newChildren.push(...result);
      } else {
        newChildren.push(...blockquoteGroup);
      }
      blockquoteGroup = [];
      currentBlockquoteId = null;
    };

    const flushMarkdownTableCandidateGroup = () => {
      newChildren.push(
        ...transformMarkdownTableCandidateGroup(markdownTableCandidateGroup, schema)
      );
      markdownTableCandidateGroup = [];
    };

    node.content.forEach((child) => {
      if (child.type.name === "paragraph") {
        const codeBlockId = child.attrs.codeBlockId;
        const tableId = child.attrs.tableId;
        const htmlBlockId = child.attrs.htmlBlockId;
        const mathBlockId = child.attrs.mathBlockId;
        const listId = child.attrs.listId;
        const blockquoteId = child.attrs.blockquoteId;
        const blockquoteSeparator = child.attrs.blockquoteSeparator;

        if (blockquoteSeparator && child.textContent.length === 0) {
          flushCodeBlockGroup();
          flushTableGroup();
          flushHtmlBlockGroup();
          flushMathBlockGroup();
          flushListGroup();
          flushBlockquoteGroup();
          flushMarkdownTableCandidateGroup();
          return;
        }

        if (codeBlockId) {
          // 代码块段落
          flushTableGroup();
          flushHtmlBlockGroup();
          flushMathBlockGroup();
          flushListGroup();
          flushBlockquoteGroup();
          flushMarkdownTableCandidateGroup();
          if (currentCodeBlockId && currentCodeBlockId !== codeBlockId) {
            flushCodeBlockGroup();
          }
          currentCodeBlockId = codeBlockId;
          codeBlockGroup.push(child);
          return;
        }

        if (tableId) {
          // 表格段落
          flushCodeBlockGroup();
          flushHtmlBlockGroup();
          flushMathBlockGroup();
          flushListGroup();
          flushBlockquoteGroup();
          flushMarkdownTableCandidateGroup();
          if (currentTableId && currentTableId !== tableId) {
            flushTableGroup();
          }
          currentTableId = tableId;
          tableGroup.push(child);
          return;
        }

        if (htmlBlockId) {
          // HTML 块段落
          flushCodeBlockGroup();
          flushTableGroup();
          flushMathBlockGroup();
          flushListGroup();
          flushBlockquoteGroup();
          flushMarkdownTableCandidateGroup();
          if (currentHtmlBlockId && currentHtmlBlockId !== htmlBlockId) {
            flushHtmlBlockGroup();
          }
          currentHtmlBlockId = htmlBlockId;
          htmlBlockGroup.push(child);
          return;
        }

        if (mathBlockId) {
          // 数学公式块段落
          flushCodeBlockGroup();
          flushTableGroup();
          flushHtmlBlockGroup();
          flushListGroup();
          flushBlockquoteGroup();
          flushMarkdownTableCandidateGroup();
          if (currentMathBlockId && currentMathBlockId !== mathBlockId) {
            flushMathBlockGroup();
          }
          currentMathBlockId = mathBlockId;
          mathBlockGroup.push(child);
          return;
        }

        if (listId) {
          // 列表段落
          flushCodeBlockGroup();
          flushTableGroup();
          flushHtmlBlockGroup();
          flushMathBlockGroup();
          flushBlockquoteGroup();
          flushMarkdownTableCandidateGroup();
          if (currentListId && currentListId !== listId) {
            flushListGroup();
          }
          currentListId = listId;
          listGroup.push(child);
          return;
        }

        if (blockquoteId) {
          // 引用块段落
          flushCodeBlockGroup();
          flushTableGroup();
          flushHtmlBlockGroup();
          flushMathBlockGroup();
          flushListGroup();
          flushMarkdownTableCandidateGroup();
          if (currentBlockquoteId && currentBlockquoteId !== blockquoteId) {
            flushBlockquoteGroup();
          }
          currentBlockquoteId = blockquoteId;
          blockquoteGroup.push(child);
          return;
        }

        // 非特殊段落，先刷新之前的组
        flushCodeBlockGroup();
        flushTableGroup();
        flushHtmlBlockGroup();
        flushMathBlockGroup();
        flushListGroup();
        flushBlockquoteGroup();

        if (child.attrs.hrSource) {
          flushMarkdownTableCandidateGroup();
          const hr = transformParagraphToHr(child, schema);
          newChildren.push(hr || child);
        } else if (isMarkdownTableCandidateLine(child)) {
          markdownTableCandidateGroup.push(child);
        } else {
          flushMarkdownTableCandidateGroup();
          newChildren.push(child);
        }
      } else {
        flushCodeBlockGroup();
        flushTableGroup();
        flushHtmlBlockGroup();
        flushMathBlockGroup();
        flushListGroup();
        flushBlockquoteGroup();
        flushMarkdownTableCandidateGroup();
        // 递归处理子节点
        const processed = processNodeForBlockConversion(child, schema);
        if (Array.isArray(processed)) {
          newChildren.push(...processed);
        } else {
          newChildren.push(processed);
        }
      }
    });

    // 刷新最后一组
    flushCodeBlockGroup();
    flushTableGroup();
    flushHtmlBlockGroup();
    flushMathBlockGroup();
    flushListGroup();
    flushBlockquoteGroup();
    flushMarkdownTableCandidateGroup();

    // 如果内容有变化，创建新节点
    const newContent = Fragment.from(newChildren);
    if (!newContent.eq(node.content)) {
      return node.type.create(node.attrs, newContent, node.marks);
    }
  }

  return node;
}

/**
 * 将文档中的特殊段落转换回对应的块级元素（代码块、图片、分割线）
 * 使用整体替换文档内容的方式，避免逐个节点操作的位置映射问题
 */
export function convertParagraphsToBlocks(tr: Transaction): Transaction {
  const doc = tr.doc;
  const schema = doc.type.schema;
  const newContent: ProseMirrorNode[] = [];

  // 收集代码块段落组
  let codeBlockGroup: ProseMirrorNode[] = [];
  let currentCodeBlockId: string | null = null;
  // 收集表格段落组
  let tableGroup: ProseMirrorNode[] = [];
  let currentTableId: string | null = null;
  // 收集 HTML 块段落组
  let htmlBlockGroup: ProseMirrorNode[] = [];
  let currentHtmlBlockId: string | null = null;
  // 收集数学公式块段落组
  let mathBlockGroup: ProseMirrorNode[] = [];
  let currentMathBlockId: string | null = null;
  // 收集列表段落组
  let listGroup: ProseMirrorNode[] = [];
  let currentListId: string | null = null;
  // 收集引用块段落组
  let blockquoteGroup: ProseMirrorNode[] = [];
  let currentBlockquoteId: string | null = null;
  let markdownTableCandidateGroup: ProseMirrorNode[] = [];

  const flushCodeBlockGroup = () => {
    if (codeBlockGroup.length === 0) return;
    const paragraphs = codeBlockGroup.map((node) => ({ node, pos: 0 }));
    const result = transformParagraphsToCodeBlock(paragraphs, schema);
    if (result) {
      newContent.push(result.codeBlock);
    } else {
      // 转换失败，保留原始段落
      newContent.push(...codeBlockGroup);
    }
    codeBlockGroup = [];
    currentCodeBlockId = null;
  };

  const flushTableGroup = () => {
    if (tableGroup.length === 0) return;
    const paragraphs = tableGroup.map((node) => ({ node, pos: 0 }));
    const result = transformParagraphsToTable(paragraphs, schema);
    if (result) {
      newContent.push(result);
    } else {
      newContent.push(...tableGroup.map(stripTableParagraphAttrs));
    }
    tableGroup = [];
    currentTableId = null;
  };

  const flushHtmlBlockGroup = () => {
    if (htmlBlockGroup.length === 0) return;
    const paragraphs = htmlBlockGroup.map((node) => ({ node, pos: 0 }));
    const result = transformParagraphsToHtmlBlock(paragraphs, schema);
    if (result) {
      newContent.push(result);
    } else {
      newContent.push(...htmlBlockGroup);
    }
    htmlBlockGroup = [];
    currentHtmlBlockId = null;
  };

  const flushMathBlockGroup = () => {
    if (mathBlockGroup.length === 0) return;
    const paragraphs = mathBlockGroup.map((node) => ({ node, pos: 0 }));
    const result = transformParagraphsToMathBlock(paragraphs, schema);
    if (result) {
      newContent.push(result);
    } else {
      newContent.push(...mathBlockGroup);
    }
    mathBlockGroup = [];
    currentMathBlockId = null;
  };

  const flushListGroup = () => {
    if (listGroup.length === 0) return;
    const paragraphs = listGroup.map((node) => ({ node, pos: 0 }));
    const result = transformParagraphsToList(paragraphs, schema);
    if (result) {
      newContent.push(...result);
    } else {
      newContent.push(...listGroup);
    }
    listGroup = [];
    currentListId = null;
  };

  const flushBlockquoteGroup = () => {
    if (blockquoteGroup.length === 0) return;
    const paragraphs = blockquoteGroup.map((node) => ({ node, pos: 0 }));
    const result = transformParagraphsToBlockquote(paragraphs, schema);
    if (result) {
      newContent.push(...result);
    } else {
      newContent.push(...blockquoteGroup);
    }
    blockquoteGroup = [];
    currentBlockquoteId = null;
  };

  const flushMarkdownTableCandidateGroup = () => {
    newContent.push(...transformMarkdownTableCandidateGroup(markdownTableCandidateGroup, schema));
    markdownTableCandidateGroup = [];
  };

  doc.forEach((node) => {
    if (node.type.name === "paragraph") {
      const codeBlockId = node.attrs.codeBlockId;
      const tableId = node.attrs.tableId;
      const htmlBlockId = node.attrs.htmlBlockId;
      const mathBlockId = node.attrs.mathBlockId;
      const listId = node.attrs.listId;
      const blockquoteId = node.attrs.blockquoteId;
      const blockquoteSeparator = node.attrs.blockquoteSeparator;

      if (blockquoteSeparator && node.textContent.length === 0) {
        flushCodeBlockGroup();
        flushTableGroup();
        flushHtmlBlockGroup();
        flushMathBlockGroup();
        flushListGroup();
        flushBlockquoteGroup();
        flushMarkdownTableCandidateGroup();
        return;
      }

      if (codeBlockId) {
        // 代码块段落
        flushTableGroup();
        flushHtmlBlockGroup();
        flushMathBlockGroup();
        flushListGroup();
        flushBlockquoteGroup();
        flushMarkdownTableCandidateGroup();
        if (currentCodeBlockId && currentCodeBlockId !== codeBlockId) {
          flushCodeBlockGroup();
        }
        currentCodeBlockId = codeBlockId;
        codeBlockGroup.push(node);
        return;
      }

      if (tableId) {
        // 表格段落
        flushCodeBlockGroup();
        flushHtmlBlockGroup();
        flushMathBlockGroup();
        flushListGroup();
        flushBlockquoteGroup();
        flushMarkdownTableCandidateGroup();
        if (currentTableId && currentTableId !== tableId) {
          flushTableGroup();
        }
        currentTableId = tableId;
        tableGroup.push(node);
        return;
      }

      if (htmlBlockId) {
        // HTML 块段落
        flushCodeBlockGroup();
        flushTableGroup();
        flushMathBlockGroup();
        flushListGroup();
        flushBlockquoteGroup();
        flushMarkdownTableCandidateGroup();
        if (currentHtmlBlockId && currentHtmlBlockId !== htmlBlockId) {
          flushHtmlBlockGroup();
        }
        currentHtmlBlockId = htmlBlockId;
        htmlBlockGroup.push(node);
        return;
      }

      if (mathBlockId) {
        // 数学公式块段落
        flushCodeBlockGroup();
        flushTableGroup();
        flushHtmlBlockGroup();
        flushListGroup();
        flushBlockquoteGroup();
        flushMarkdownTableCandidateGroup();
        if (currentMathBlockId && currentMathBlockId !== mathBlockId) {
          flushMathBlockGroup();
        }
        currentMathBlockId = mathBlockId;
        mathBlockGroup.push(node);
        return;
      }

      if (listId) {
        // 列表段落
        flushCodeBlockGroup();
        flushTableGroup();
        flushHtmlBlockGroup();
        flushMathBlockGroup();
        flushBlockquoteGroup();
        flushMarkdownTableCandidateGroup();
        if (currentListId && currentListId !== listId) {
          flushListGroup();
        }
        currentListId = listId;
        listGroup.push(node);
        return;
      }

      if (blockquoteId) {
        // 引用块段落
        flushCodeBlockGroup();
        flushTableGroup();
        flushHtmlBlockGroup();
        flushMathBlockGroup();
        flushListGroup();
        flushMarkdownTableCandidateGroup();
        if (currentBlockquoteId && currentBlockquoteId !== blockquoteId) {
          flushBlockquoteGroup();
        }
        currentBlockquoteId = blockquoteId;
        blockquoteGroup.push(node);
        return;
      }

      // 非特殊段落，先刷新之前的组
      flushCodeBlockGroup();
      flushTableGroup();
      flushHtmlBlockGroup();
      flushMathBlockGroup();
      flushListGroup();
      flushBlockquoteGroup();

      if (node.attrs.hrSource) {
        // 分割线段落
        flushMarkdownTableCandidateGroup();
        const hr = transformParagraphToHr(node, schema);
        newContent.push(hr || node);
      } else if (isMarkdownTableCandidateLine(node)) {
        markdownTableCandidateGroup.push(node);
      } else {
        flushMarkdownTableCandidateGroup();
        newContent.push(node);
      }
    } else {
      flushCodeBlockGroup();
      flushTableGroup();
      flushHtmlBlockGroup();
      flushMathBlockGroup();
      flushListGroup();
      flushBlockquoteGroup();
      flushMarkdownTableCandidateGroup();
      // 递归处理子节点
      const processed = processNodeForBlockConversion(node, schema);
      if (Array.isArray(processed)) {
        newContent.push(...processed);
      } else {
        newContent.push(processed);
      }
    }
  });

  // 刷新最后一组
  flushCodeBlockGroup();
  flushTableGroup();
  flushHtmlBlockGroup();
  flushMathBlockGroup();
  flushListGroup();
  flushBlockquoteGroup();
  flushMarkdownTableCandidateGroup();

  applyConvertedContent(tr, newContent);

  return tr;
}

/**
 * 创建源码模式文档转换插件
 */
export function createSourceViewTransformPlugin(): Plugin {
  return new Plugin({
    key: sourceViewTransformPluginKey,

    appendTransaction(transactions, oldState, newState) {
      if (transactions.some((tr) => tr.getMeta(sourceViewTransformAppliedMeta))) return null;

      // 检查是否有源码模式切换
      const oldDecorationState = decorationPluginKey.getState(oldState);
      const newDecorationState = decorationPluginKey.getState(newState);

      if (!oldDecorationState || !newDecorationState) return null;

      const oldSourceView = oldDecorationState.sourceView;
      const newSourceView = newDecorationState.sourceView;

      // 源码模式状态发生变化
      if (oldSourceView !== newSourceView) {
        const tr = newState.tr.setMeta("addToHistory", false);

        if (newSourceView) {
          // 进入源码模式：将块级元素转换为段落
          convertBlocksToParagraphs(tr);
        } else {
          // 退出源码模式：将段落转换回块级元素
          convertParagraphsToBlocks(tr);
        }

        // 如果有变化，返回 transaction
        return tr.docChanged ? tr : null;
      }

      // 在源码模式下，检查文档中是否有未转换的块级节点
      // （例如通过 setMarkdown 重新加载内容时产生的）
      if (newSourceView) {
        let hasBlocks = false;
        newState.doc.descendants((node) => {
          if (
            node.type.name === "code_block" ||
            node.type.name === "horizontal_rule" ||
            node.type.name === "table" ||
            node.type.name === "html_block" ||
            node.type.name === "math_block" ||
            node.type.name === "bullet_list" ||
            node.type.name === "ordered_list" ||
            node.type.name === "task_list" ||
            node.type.name === "blockquote"
          ) {
            hasBlocks = true;
          }
          return !hasBlocks; // 找到一个就停止遍历
        });

        if (hasBlocks) {
          const tr = newState.tr.setMeta("addToHistory", false);
          convertBlocksToParagraphs(tr);
          return tr.docChanged ? tr : null;
        }
      }

      return null;
    },
  });
}
