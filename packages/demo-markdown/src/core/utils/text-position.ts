/**
 * 跨文档的位置映射（`setMarkdown` 用）。
 *
 * `setMarkdown` 是「整篇替换」：`replaceWith(0, size, …)` 这类 step 的 StepMap 会把
 * 整个被替换区间塌缩成一个点，ProseMirror 自己的 position mapping 在这里无能为力——
 * 结果是光标被扔回文档开头（或落在一个与用户操作无关的位置）。
 *
 * 这里不引入哨兵字符、也不改文档，而是用「光标前的文本锚点」做一次纯函数映射：
 *   1. 取旧文档里光标之前的 N 个字符当锚点；
 *   2. 在新文档的纯文本里找出锚点的全部出现位置，选离原偏移最近的那次；
 *   3. 命中 → 落在锚点之后；未命中（内容整体换掉）→ 退化为「就近的合法位置」。
 *
 * 只要外部同步进来的内容在光标之前没被改动（宿主回填、格式化重排等最常见的情形），
 * 光标就停在同一个语义位置，而不是跳回开头。
 *
 * 之所以单独放成纯函数：`MilkupEditor` 依赖 DOM 无法在 node 环境单测，
 * 而这段映射逻辑恰恰是最需要被钉住的部分。
 */
import type { Node } from "prosemirror-model";

/** 锚点长度：太短容易误命中，太长则在外部改动稍多时匹配不上 */
export const ANCHOR_LENGTH = 24;

interface TextSegment {
  /** 该文本节点在「拉平文本」里的起始下标 */
  flatStart: number;
  /** 该文本节点在文档里的起始位置 */
  docPos: number;
  text: string;
}

/**
 * 把文档里的文本节点拉平成一维文本，并记录每段对应的文档位置。
 *
 * `upTo` 用于只要「某个位置之前的文本」（先序遍历天然是文档顺序，遇到越界即可停止累积）。
 */
function flattenText(doc: Node, upTo?: number): { text: string; segments: TextSegment[] } {
  const segments: TextSegment[] = [];
  let text = "";
  let reachedEnd = false;

  doc.descendants((node, pos) => {
    if (reachedEnd) return false;
    if (!node.isText || !node.text) return true;

    let content = node.text;
    if (upTo !== undefined) {
      const remain = upTo - pos;
      if (remain <= 0) {
        reachedEnd = true;
        return false;
      }
      if (content.length > remain) {
        content = content.slice(0, remain);
        reachedEnd = true;
      }
    }

    segments.push({ flatStart: text.length, docPos: pos, text: content });
    text += content;
    return !reachedEnd;
  });

  return { text, segments };
}

/** 拉平文本下标 → 文档位置 */
function docPositionAt(segments: TextSegment[], flatIndex: number): number | null {
  for (const segment of segments) {
    const offset = flatIndex - segment.flatStart;
    if (offset >= 0 && offset <= segment.text.length) {
      return segment.docPos + offset;
    }
  }
  return null;
}

/**
 * 把 `oldDoc` 里的 `oldPos` 映射到 `newDoc` 的对应位置。
 *
 * 返回值一定落在 `[0, newDoc.content.size]` 内，调用方可以直接 `resolve`。
 */
export function mapPositionByTextAnchor(oldDoc: Node, oldPos: number, newDoc: Node): number {
  const fallback = (): number => Math.min(Math.max(0, oldPos), newDoc.content.size);

  const before = flattenText(oldDoc, oldPos);
  const anchor = before.text.slice(-ANCHOR_LENGTH);
  // 锚点不足（光标在文档很开头）时没有可靠信息，直接就近落点
  if (anchor.length < ANCHOR_LENGTH) return fallback();

  const target = flattenText(newDoc);
  const wanted = before.text.length;

  // 同一段文本在文档里可能出现多次（例如重复的代码行），取离原偏移最近的一次
  let bestFlatIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (
    let index = target.text.indexOf(anchor);
    index !== -1;
    index = target.text.indexOf(anchor, index + 1)
  ) {
    const afterAnchor = index + anchor.length;
    const distance = Math.abs(afterAnchor - wanted);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestFlatIndex = afterAnchor;
    }
  }

  if (bestFlatIndex === null) return fallback();
  return docPositionAt(target.segments, bestFlatIndex) ?? fallback();
}
