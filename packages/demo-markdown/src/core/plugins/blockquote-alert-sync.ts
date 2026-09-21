/**
 * Milkup 引用告示块同步插件
 *
 * 被动识别 blockquote 首行中的 GitHub Alert 标记：
 * > [!NOTE]
 *
 * 实时输入时，blockquote 输入规则会把行首 `>` 消费掉，所以首段文本可能是：
 * - `> [!NOTE]`：来自文件解析/粘贴解析
 * - `[!NOTE]`：来自编辑器内直接输入
 *
 * 同步 blockquote 节点属性；当用户刚输入完整 marker 且当前块只有 marker 行时，
 * 自动插入下一空行，等价于用户手动按一次回车。
 */

import { Node } from "prosemirror-model";
import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { decorationPluginKey } from "../decorations";

export const blockquoteAlertSyncPluginKey = new PluginKey<DecorationSet>(
  "milkup-blockquote-alert-sync"
);
export const blockquoteAlertKeymapPluginKey = new PluginKey("milkup-blockquote-alert-keymap");

type AlertMarker = {
  /** 标记文本区间（用于隐藏标记、挂图标） */
  from: number;
  to: number;
  /** 标记所在行结束后的位置：删除时应删到这里，保留同一段里的正文 */
  lineEnd: number;
  /** 标记是否独占整段（用于判断是否需要自动补一个空段） */
  wholeParagraph: boolean;
  type: string;
  blockquotePos: number;
  paragraphPos: number;
  paragraphNodeSize: number;
};

/**
 * 告示标记匹配。
 *
 * 标记位于首段开头，**允许同一段后面还有正文**（GFM 的写法是
 * `> [!NOTE]\n> 正文`，正文与标记同属一个 paragraph），也允许标记独占整段
 * （编辑器内直接输入标记、还没敲正文时的中间态）。
 */
const ALERT_MARKER_PATTERN =
  /^(?<prefix>\s*(?:>\s*)?)(?<marker>\[!(?<type>NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])(?=\s|$)(?<rest>[\s\S]*)$/i;

const SVG_NS = "http://www.w3.org/2000/svg";
const ALERT_ICON_PATHS: Record<string, string[]> = {
  note: ["circle:12,12,10", "line:12,16,12,12", "line:12,8,12.01,8"],
  tip: [
    "path:M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1.3.5 2.6 1.5 3.5.8.8 1.3 1.5 1.5 2.5",
    "path:M9 18h6",
    "path:M10 22h4",
    "path:M10 14h4",
  ],
  important: ["circle:12,12,10", "line:12,8,12,12", "line:12,16,12.01,16"],
  warning: [
    "path:m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
    "line:12,9,12,13",
    "line:12,17,12.01,17",
  ],
  caution: ["path:M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20", "line:15,9,9,15", "line:9,9,15,15"],
};

/** 标题行文案：图标之后跟的固定文本，取值与 GitHub 渲染一致 */
const ALERT_TITLES: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

function appendSvgShape(svg: SVGElement, descriptor: string): void {
  const [kind, value] = descriptor.split(":");
  if (kind === "circle") {
    const [cx, cy, r] = value.split(",");
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", cy);
    circle.setAttribute("r", r);
    svg.appendChild(circle);
    return;
  }

  if (kind === "line") {
    const [x1, y1, x2, y2] = value.split(",");
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    svg.appendChild(line);
    return;
  }

  if (kind === "path") {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", value);
    svg.appendChild(path);
  }
}

function createAlertSvgIcon(type: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const paths = ALERT_ICON_PATHS[type] ?? ALERT_ICON_PATHS.note;
  paths.forEach((descriptor) => appendSvgShape(svg, descriptor));
  return svg;
}

/**
 * 段落的可见文本：软换行（`hard_break` 节点）还原成 `\n`。
 *
 * 换行现在是节点、不是文本字符，`textContent` 会把两行直接粘起来，
 * `[!NOTE]` 后面的 `(?=\s|$)` 判据就会失效——这里按渲染效果还原。
 */
function paragraphTextWithBreaks(paragraph: Node): string {
  let text = "";
  paragraph.forEach((child) => {
    if (child.isText) {
      text += child.text ?? "";
    } else if (child.type.name === "hard_break") {
      text += child.attrs.raw ?? "\n";
    }
  });
  return text;
}

function getBlockquoteAlertType(node: Node): string | null {
  if (node.type.name !== "blockquote") return null;

  const firstChild = node.firstChild;
  if (!firstChild || firstChild.type.name !== "paragraph") return null;

  const type = paragraphTextWithBreaks(firstChild).match(ALERT_MARKER_PATTERN)?.groups?.type;
  return type ? type.toLowerCase() : null;
}

function findBlockquoteAlertMarker(node: Node, pos: number): AlertMarker | null {
  if (node.type.name !== "blockquote") return null;

  const paragraph = node.firstChild;
  if (!paragraph || paragraph.type.name !== "paragraph") return null;

  const groups = paragraphTextWithBreaks(paragraph).match(ALERT_MARKER_PATTERN)?.groups;
  if (!groups?.marker || !groups.type) return null;

  const paragraphPos = pos + 1;
  const contentStart = paragraphPos + 1;
  // 标记一定在第一个换行之前，所以字符偏移与文档位置一一对应
  const from = contentStart + groups.prefix.length;
  const to = from + groups.marker.length;

  /*
   * 标记行末尾 = 标记之后第一个换行节点，删除时连它一起带走，正文才能顶上首行。
   *
   * 这里按**节点**扫描而不是 textContent 字符偏移：软换行是 `hard_break` 节点
   * （占 1 个文档位、不出现在 textContent 里），字符偏移与文档位置已不再一一对应。
   */
  let lineEnd = contentStart + paragraph.content.size;
  let wholeParagraph = true;

  paragraph.forEach((child, offset) => {
    if (!wholeParagraph || contentStart + offset < to) return;
    if (child.type.name === "hard_break") {
      lineEnd = contentStart + offset + child.nodeSize;
      wholeParagraph = false;
    }
  });

  return {
    from,
    to,
    lineEnd,
    wholeParagraph,
    type: groups.type.toLowerCase(),
    blockquotePos: pos,
    paragraphPos,
    paragraphNodeSize: paragraph.nodeSize,
  };
}

/**
 * 标记之后的第一段正文起点：跳过换行与续行前缀（`> `，嵌套时可能多层）。
 *
 * 点标题把光标放这里最自然（接着写正文）。不能停在前缀之前——
 * 那样插入的字符会夹在 `\n` 与 `> ` 之间，续行前缀便不再位于行首，
 * 往返解析时 `> ` 会漏成正文。
 */
function contentStart(doc: Node, marker: AlertMarker): number {
  const paragraphEnd = marker.paragraphPos + marker.paragraphNodeSize;
  let pos = marker.lineEnd;

  while (pos < paragraphEnd) {
    const $pos = doc.resolve(pos);
    const next = $pos.nodeAfter;
    if (!next || !next.isText) break;
    const isContinuationPrefix = next.marks.some(
      (m) => m.type.name === "syntax_marker" && m.attrs.syntaxType === "blockquote"
    );
    if (!isContinuationPrefix) break;
    pos += next.nodeSize;
  }

  return pos;
}

/**
 * 标题行：图标 + 固定文案（`Note` / `Tip` / …）。
 *
 * 它整体是标记的渲染形态。点击时把光标送到**正文开头**（标记那一行之后）：
 * 既符合「点标题开始写正文」的直觉，也避免在标记前面落点——
 * 标记是段落首部的结构约束，在它前面或里面插入字符都会毁掉告示结构。
 *
 * 只 preventDefault 不行：目标是不可编辑的，浏览器不会给出落点，
 * PM 也无从按坐标放置光标，光标会被丢回上一次的位置（首次点击甚至会掉回文档开头）。
 */
function createAlertTitle(marker: AlertMarker, view: EditorView): HTMLElement {
  const title = document.createElement("span");
  title.className = `milkup-blockquote-alert-title milkup-blockquote-alert-title-${marker.type}`;
  title.setAttribute("contenteditable", "false");

  const icon = document.createElement("button");
  icon.type = "button";
  icon.className = `milkup-blockquote-alert-icon milkup-blockquote-alert-icon-${marker.type}`;
  icon.appendChild(createAlertSvgIcon(marker.type));
  icon.title = "告示标记";
  icon.setAttribute("aria-label", "告示标记");
  icon.setAttribute("contenteditable", "false");

  title.appendChild(icon);
  title.appendChild(document.createTextNode(ALERT_TITLES[marker.type] ?? marker.type));

  title.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const { doc } = view.state;
    const pos = Math.min(contentStart(doc, marker), doc.content.size);
    view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(pos), 1)));
    view.focus();
  });

  return title;
}

function findAlertMarkerAt(doc: Node, pos: number): AlertMarker | null {
  let found: AlertMarker | null = null;

  doc.descendants((node, nodePos) => {
    if (found) return false;
    if (node.type.name !== "blockquote") return true;

    const marker = findBlockquoteAlertMarker(node, nodePos);
    if (marker && pos >= marker.from && pos <= marker.to) {
      found = marker;
      return false;
    }
    return true;
  });

  return found;
}

/**
 * 光标恰好停在正文开头（即标记之后）时也算贴着标记，
 * 这样在正文第一个字前面按 Backspace 能一次性删掉整行标记。
 */
function findMarkerBeforeContentStart(doc: Node, pos: number): AlertMarker | null {
  let found: AlertMarker | null = null;

  doc.descendants((node, nodePos) => {
    if (found) return false;
    if (node.type.name !== "blockquote") return true;

    const marker = findBlockquoteAlertMarker(node, nodePos);
    if (!marker || marker.wholeParagraph) return true;

    if (pos === marker.lineEnd) {
      found = marker;
      return false;
    }

    return true;
  });

  return found;
}

/**
 * 标记是结构标记（与 `> ` 续行前缀同类），不作为可编辑文本。
 *
 * 光标落入标记内部时，按移动方向吸附到对应边界——等效于「箭头跳过这个原子」：
 *   - 从左往右进来 → 落到标记之后（正文开头）
 *   - 从右往左进来 → 落到标记之前
 * 这样光标既不会停在一个 0 号字的隐藏区间里（看起来像丢了），
 * 也不会把 `[!NOTE]` 当普通文本改坏（它是段落首部的结构约束，
 * 改一个字就会连带毁掉 `\n> ` 续行、整块告示样式与正文）。
 */
function snapOutOfMarker(state: EditorState, oldState: EditorState): number | null {
  const head = state.selection.head;
  if (!state.selection.empty) return null;
  const prevHead = oldState.selection.head;

  let target: number | null = null;
  state.doc.descendants((node, pos) => {
    if (target !== null) return false;
    const marker = findBlockquoteAlertMarker(node, pos);
    if (!marker) return true;
    if (head > marker.from && head < marker.to) {
      target = head < prevHead ? marker.from : marker.to;
      return false;
    }
    return true;
  });

  return target;
}

function buildDecorations(state: EditorState, sourceView: boolean): DecorationSet {
  if (sourceView) return DecorationSet.empty;

  const doc = state.doc;
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    const marker = findBlockquoteAlertMarker(node, pos);
    if (!marker) return true;

    decorations.push(
      Decoration.widget(marker.from, (view) => createAlertTitle(marker, view), {
        key: `blockquote-alert-${marker.from}-${marker.to}-${marker.type}`,
        side: -1,
      })
    );
    decorations.push(
      Decoration.inline(marker.from, marker.to, {
        class: "milkup-blockquote-alert-marker-hidden",
        contenteditable: "false",
        "aria-hidden": "true",
      })
    );

    return true;
  });

  return DecorationSet.create(doc, decorations);
}

export function createBlockquoteAlertKeymapPlugin(): Plugin {
  return new Plugin({
    key: blockquoteAlertKeymapPluginKey,

    props: {
      handleKeyDown(view, event) {
        if (event.key !== "Backspace" && event.key !== "Delete") return false;
        const { selection } = view.state;
        if (!selection.empty) return false;

        const marker =
          findMarkerBeforeContentStart(view.state.doc, selection.from) ??
          (event.key === "Backspace"
            ? findAlertMarkerAt(view.state.doc, selection.from - 1)
            : findAlertMarkerAt(view.state.doc, selection.from));
        if (!marker) return false;

        event.preventDefault();
        // 标记独占整段：整段删掉；标记与正文同段：只删标记那一行，保留正文
        const [delFrom, delTo] = marker.wholeParagraph
          ? [marker.paragraphPos, marker.paragraphPos + marker.paragraphNodeSize]
          : [marker.from, marker.lineEnd];
        const tr = view.state.tr.delete(delFrom, delTo);
        const nextPos = Math.min(delFrom, tr.doc.content.size);
        tr.setSelection(TextSelection.near(tr.doc.resolve(nextPos), 1));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },
  });
}

export function createBlockquoteAlertSyncPlugin(): Plugin {
  return new Plugin({
    key: blockquoteAlertSyncPluginKey,

    state: {
      init(_, state) {
        const sourceView = decorationPluginKey.getState(state)?.sourceView ?? false;
        return buildDecorations(state, sourceView);
      },
      apply(tr, oldDecorations, oldState, newState) {
        const oldSourceView = decorationPluginKey.getState(oldState)?.sourceView ?? false;
        const newSourceView = decorationPluginKey.getState(newState)?.sourceView ?? false;
        // 选区变化同样要重算：标记显隐跟着光标走
        const selectionChanged = !oldState.selection.eq(newState.selection);
        if (!tr.docChanged && !selectionChanged && oldSourceView === newSourceView) {
          return oldDecorations.map(tr.mapping, tr.doc);
        }
        return buildDecorations(newState, newSourceView);
      },
    },

    props: {
      decorations(state) {
        return blockquoteAlertSyncPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },

    appendTransaction(transactions, oldState, newState) {
      if (transactions.some((tr) => tr.getMeta("blockquote-alert-sync"))) return null;

      let tr = newState.tr;
      let changed = false;
      let insertedNextLine = false;

      // 光标吸附（选区变化也要处理，所以不能一上来就按 docChanged 提前返回）
      const snappedPos = snapOutOfMarker(newState, oldState);
      if (snappedPos !== null) {
        tr = tr.setSelection(TextSelection.near(tr.doc.resolve(snappedPos), 1));
        changed = true;
      }

      if (!transactions.some((t) => t.docChanged)) {
        if (!changed) return null;
        tr = tr.setMeta("blockquote-alert-sync", true);
        return tr;
      }

      newState.doc.descendants((node, pos) => {
        if (node.type.name !== "blockquote") return true;

        const alertType = getBlockquoteAlertType(node);
        const currentAlertType = node.attrs.alertType ?? null;
        if (alertType === currentAlertType) return true;

        tr = tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          alertType,
        });
        changed = true;

        const marker = findBlockquoteAlertMarker(node, pos);
        // 只有「标记独占整段」这个中间态才需要自动补一个空段让用户接着写正文
        const shouldInsertNextLine =
          marker &&
          marker.wholeParagraph &&
          node.childCount === 1 &&
          newState.selection.empty &&
          newState.selection.from >= marker.from &&
          newState.selection.from <= marker.to;

        if (shouldInsertNextLine) {
          const insertPos = marker.paragraphPos + marker.paragraphNodeSize;
          const paragraph = newState.schema.nodes.paragraph.create();
          tr = tr.insert(insertPos, paragraph);
          tr = tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1), 1));
          insertedNextLine = true;
        }

        return true;
      });

      if (!changed) return null;
      tr.setMeta("blockquote-alert-sync", true);
      return insertedNextLine ? tr.scrollIntoView() : tr;
    },
  });
}
