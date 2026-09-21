/**
 * Milkup Markdown 序列化器
 *
 * 将 ProseMirror 文档序列化为 Markdown 文本
 */

import { Node, Fragment } from "prosemirror-model";

/** 序列化选项 */
export interface SerializeOptions {
  /** 是否使用紧凑模式（减少空行） */
  compact?: boolean;
  /** 列表缩进字符数 */
  listIndent?: number;
  /** 代码块围栏字符 */
  codeFence?: string;
}

const defaultOptions: SerializeOptions = {
  compact: false,
  listIndent: 2,
  codeFence: "```",
};

/**
 * Markdown 序列化器类
 */
export class MarkdownSerializer {
  private options: SerializeOptions;

  constructor(options: SerializeOptions = {}) {
    this.options = { ...defaultOptions, ...options };
  }

  /**
   * 序列化文档
   */
  serialize(doc: Node): string {
    const lines: string[] = [];
    this.serializeFragment(doc.content, lines, "");
    return lines.join("\n");
  }

  /**
   * 序列化 Fragment
   */
  private serializeFragment(fragment: Fragment, lines: string[], indent: string): void {
    fragment.forEach((node, _, index) => {
      this.serializeNode(node, lines, indent, index, fragment);
    });
  }

  /**
   * 序列化节点
   */
  private serializeNode(
    node: Node,
    lines: string[],
    indent: string,
    index: number,
    fragment: Fragment
  ): void {
    const handler = this.nodeHandlers[node.type.name];
    if (handler) {
      handler.call(this, node, lines, indent, index, fragment);
    } else {
      // 默认处理：递归处理子节点
      this.serializeFragment(node.content, lines, indent);
    }
  }

  /**
   * 节点处理器映射
   */
  private nodeHandlers: Record<
    string,
    (node: Node, lines: string[], indent: string, index: number, fragment: Fragment) => void
  > = {
    paragraph: (node, lines, indent) => {
      // 对于代码块段落，直接输出文本内容（包含围栏符号）
      if (node.attrs.codeBlockId) {
        const text = node.textContent;
        lines.push(indent + text);
        const isLastLine = node.attrs.lineIndex === node.attrs.totalLines - 1;
        if (isLastLine && !this.options.compact) lines.push("");
      } else if (node.attrs.tableId) {
        // 对于表格段落，直接输出文本内容（包含表格语法）
        const text = node.textContent;
        lines.push(indent + text);
        const isLastLine = node.attrs.tableRowIndex === node.attrs.tableTotalRows - 1;
        if (isLastLine && !this.options.compact) lines.push("");
      } else if (node.attrs.htmlBlockId) {
        // 对于 HTML 块段落，直接输出文本内容
        const text = node.textContent;
        lines.push(indent + text);
        const isLastLine = node.attrs.htmlBlockLineIndex === node.attrs.htmlBlockTotalLines - 1;
        if (isLastLine && !this.options.compact) lines.push("");
      } else if (node.attrs.mathBlockId) {
        // 对于数学公式块段落，直接输出文本内容（包含 $$ 符号）
        const text = node.textContent;
        lines.push(indent + text);
        const isLastLine = node.attrs.mathBlockLineIndex === node.attrs.mathBlockTotalLines - 1;
        if (isLastLine && !this.options.compact) lines.push("");
      } else if (node.attrs.listId) {
        // 对于列表段落，直接输出文本内容（包含列表标记）
        const text = node.textContent;
        lines.push(indent + text);
        const isLastLine = node.attrs.listLineIndex === node.attrs.listTotalLines - 1;
        if (isLastLine && !this.options.compact) lines.push("");
      } else if (node.attrs.blockquoteId) {
        // 对于引用块段落，直接输出文本内容（包含引用标记）
        const text = node.textContent;
        lines.push(indent + text);
        const isLastLine = node.attrs.blockquoteLineIndex === node.attrs.blockquoteTotalLines - 1;
        if (isLastLine && !this.options.compact) lines.push("");
      } else if (node.attrs.blockquoteSeparator) {
        // 源码模式下相邻引用块之间的普通空行
        lines.push(indent + node.textContent);
      } else {
        const text = this.serializeInline(node);
        lines.push(indent + text);
        // 空段落（用于保留原始空行）不追加分隔空行
        if (!this.options.compact && text.length > 0) lines.push("");
      }
    },

    heading: (node, lines, indent) => {
      // serializeInline 现在直接输出所有文本（包括 ### 语法标记），无需手动添加
      const text = this.serializeInline(node);
      lines.push(indent + text);
      if (!this.options.compact) lines.push("");
    },

    blockquote: (node, lines, indent, index, fragment) => {
      // 逐个序列化子节点，自行控制分隔符，避免 !compact 空行
      // 被转为 ">" 导致重新解析时产生多余空段落（往返膨胀问题）。
      //
      // 稳定性原理：
      //   内容段落后加一个 ">" 分隔符，空段落之间不加分隔符。
      //   N 个空段落 + 前方 1 个 ">" 分隔符 = N+1 个空 contentLine
      //   → parseBlocks 的 extra = (N+1)-1 = N → 恰好还原 N 个空段落
      let prevWasContent = false; // 上一个子节点是否为有内容的段落
      const alertMarkerPattern = /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;
      node.content.forEach((child, _, index) => {
        const childLines: string[] = [];
        this.serializeNode(child, childLines, "", index, node.content);

        // 剥离 paragraph 序列化器追加的 !compact 尾部空行
        while (childLines.length > 0 && childLines[childLines.length - 1] === "") {
          childLines.pop();
        }

        // 判断当前子节点是否为空段落（文本仅为 "> " 即引用前缀）
        const isEmptyParagraph =
          child.type.name === "paragraph" &&
          childLines.length === 1 &&
          (childLines[0].trim() === ">" || childLines[0] === "> ");
        const isAlertFirstContentParagraph =
          Boolean(node.attrs.alertType) &&
          index === 1 &&
          node.firstChild?.type.name === "paragraph" &&
          alertMarkerPattern.test(node.firstChild.textContent);

        // 嵌套引用自身的每一行已经带了一层 ">"，再插分隔符会多出一个空引用行
        const childIsBlockquote = child.type.name === "blockquote";

        // 仅在上一个子节点是有内容的段落时，才插入 ">" 分隔符。
        // 空段落之间不加分隔符，避免分隔符被解析为额外空行导致膨胀。
        if (prevWasContent && !isAlertFirstContentParagraph && !childIsBlockquote) {
          lines.push(indent + ">");
        }

        for (const line of childLines) {
          // 源码模式下段落文本自带 ">"（语法标记），这里不再重复加；
          // 而嵌套引用是真实节点，必须再补外层这一层 ">"。
          if (!childIsBlockquote && line.startsWith("> ")) {
            lines.push(indent + line);
          } else if (line === "") {
            lines.push(indent + ">");
          } else {
            lines.push(indent + "> " + line);
          }
        }

        prevWasContent = !isEmptyParagraph;
      });
      const nextNode = index + 1 < fragment.childCount ? fragment.child(index + 1) : null;
      if (!this.options.compact || nextNode?.type.name === "blockquote") lines.push("");
    },

    code_block: (node, lines, indent) => {
      const content = node.textContent;

      // 缩进式代码块：按 4 空格还原，不转成围栏
      if (node.attrs.indented) {
        if (content) {
          for (const line of content.split("\n")) {
            lines.push(line ? indent + "    " + line : "");
          }
        }
        if (!this.options.compact) lines.push("");
        return;
      }

      // 保留原文的围栏形态（``` / ~~~、长度、info string）
      const fence = node.attrs.fence || this.options.codeFence!;
      const meta = node.attrs.meta || "";
      const info = node.attrs.language || "";
      lines.push(indent + fence + info + (meta ? " " + meta : ""));
      if (content) {
        for (const line of content.split("\n")) {
          lines.push(indent + line);
        }
      }
      lines.push(indent + fence);
      if (!this.options.compact) lines.push("");
    },

    frontmatter: (node, lines, indent) => {
      lines.push(indent + "---");
      const content = node.textContent || "";
      if (content) {
        for (const line of content.split("\n")) {
          lines.push(indent + line);
        }
      }
      lines.push(indent + "---");
      if (!this.options.compact) lines.push("");
    },

    horizontal_rule: (node, lines, indent) => {
      lines.push(indent + (node.attrs.marker || "---"));
      if (!this.options.compact) lines.push("");
    },

    bullet_list: (node, lines, indent) => {
      const marker = node.attrs.marker || "-";
      const spread = Boolean(node.attrs.spread);
      node.content.forEach((item, _, i) => {
        this.serializeListItem(item, lines, indent, marker, spread && i > 0);
      });
      if (!this.options.compact) lines.push("");
    },

    ordered_list: (node, lines, indent) => {
      const start = (node.attrs.start as number) || 1;
      const delimiter = node.attrs.delimiter || ".";
      const spread = Boolean(node.attrs.spread);
      node.content.forEach((item, _, i) => {
        this.serializeListItem(item, lines, indent, `${start + i}${delimiter}`, spread && i > 0);
      });
      if (!this.options.compact) lines.push("");
    },

    task_list: (node, lines, indent) => {
      const spread = Boolean(node.attrs.spread);
      node.content.forEach((item, _, i) => {
        const checked = item.attrs.checked ? "x" : " ";
        this.serializeListItem(item, lines, indent, `- [${checked}]`, spread && i > 0);
      });
      if (!this.options.compact) lines.push("");
    },

    table: (node, lines, indent) => {
      const rows: string[][] = [];
      const aligns: Array<string | null> = [];
      let headerRow: string[] = [];

      node.content.forEach((row, _, rowIndex) => {
        const cells: string[] = [];
        row.content.forEach((cell, __, cellIndex) => {
          cells.push(this.serializeTableCellInline(cell));
          if (rowIndex === 0) aligns[cellIndex] = (cell.attrs.align as string | null) ?? null;
        });
        if (rowIndex === 0) {
          headerRow = cells;
        }
        rows.push(cells);
      });

      if (headerRow.length > 0) {
        // 表头
        lines.push(indent + "| " + headerRow.join(" | ") + " |");
        // 分隔行：还原对齐标记（左 :--- / 居中 :---: / 右 ---:）
        const separators = headerRow.map((_, index) => {
          switch (aligns[index]) {
            case "left":
              return ":---";
            case "center":
              return ":---:";
            case "right":
              return "---:";
            default:
              return "---";
          }
        });
        lines.push(indent + "| " + separators.join(" | ") + " |");
        // 数据行
        for (let i = 1; i < rows.length; i++) {
          lines.push(indent + "| " + rows[i].join(" | ") + " |");
        }
      }
      if (!this.options.compact) lines.push("");
    },

    math_block: (node, lines, indent) => {
      lines.push(indent + "$$");
      const content = node.textContent || "";
      if (content) {
        for (const line of content.split("\n")) {
          lines.push(indent + line);
        }
      }
      lines.push(indent + "$$");
      if (!this.options.compact) lines.push("");
    },

    html_block: (node, lines, indent) => {
      const content = node.textContent || "";
      for (const line of content.split("\n")) {
        lines.push(indent + line);
      }
      if (!this.options.compact) lines.push("");
    },

    // 引用式链接 / 脚注定义：原文逐行还原（块内容必须是真实文本，不能改写）
    link_definition: (node, lines, indent, index, fragment) => {
      const content = node.textContent || "";
      for (const line of content.split("\n")) {
        lines.push(indent + line);
      }
      // 连续的定义之间不留空行：这是真实 Markdown 的常见写法，
      // 插入空行会改写用户文件；两条定义之间带不带空行在 AST 上不可区分，
      // 因此统一收敛到「紧挨着」这一规范形（幂等）。
      const next = index + 1 < fragment.childCount ? fragment.child(index + 1) : null;
      if (!this.options.compact && next?.type.name !== "link_definition") lines.push("");
    },

    hard_break: () => {
      // 硬换行在行内处理
    },
  };

  /**
   * 序列化列表项
   *
   * @param leadingBlank 松散列表的项之间需要留一个空行
   */
  private serializeListItem(
    item: Node,
    lines: string[],
    indent: string,
    marker: string,
    leadingBlank = false
  ): void {
    const innerLines: string[] = [];
    this.serializeFragment(item.content, innerLines, "");

    // 续行缩进需要与标记宽度对齐，例如 "- " = 2, "1. " = 3, "10. " = 4
    const continuationIndent = marker.length + 1;

    if (leadingBlank) lines.push("");

    for (let i = 0; i < innerLines.length; i++) {
      const line = innerLines[i];
      if (i === 0) {
        lines.push(indent + marker + " " + line);
      } else if (line !== "") {
        lines.push(indent + " ".repeat(continuationIndent) + line);
      }
    }
  }

  /**
   * 序列化行内内容
   * 直接输出所有文本节点（包括语法标记），保留用户原始输入
   */
  private serializeInline(node: Node, options: { hardBreak?: string } = {}): string {
    let result = "";

    node.content.forEach((child) => {
      if (child.isText) {
        // 图片等行内语法本身就是真实文本（原文即 markdown），直接输出
        result += child.text || "";
      } else if (child.type.name === "hard_break") {
        // 表格单元格里必须写成 HTML <br>；其余位置还原原文写法（两空格或反斜杠）
        result += options.hardBreak ?? (child.attrs.raw as string) ?? "  \n";
      }
    });

    return result;
  }

  /**
   * 序列化 Markdown 表格单元格内的行内内容。
   * Markdown 表格不能包含真实换行，单元格换行统一写成 HTML <br> 标签。
   */
  serializeTableCellInline(node: Node): string {
    return this.serializeInline(node, { hardBreak: "<br>" });
  }

}

/** 默认序列化器实例 */
export const defaultSerializer = new MarkdownSerializer();

/**
 * 序列化文档为 Markdown
 */
export function serializeMarkdown(doc: Node, options?: SerializeOptions): string {
  const serializer = options ? new MarkdownSerializer(options) : defaultSerializer;
  return serializer.serialize(doc);
}
