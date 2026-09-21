/**
 * Milkup HTML 块 NodeView
 *
 * 渲染 HTML 内容，支持编辑模式和预览模式切换
 * 编辑模式使用 CodeMirror 6 + HTML 语法高亮
 */

import { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorView as ProseMirrorView, NodeView } from "prosemirror-view";
import { Selection, TextSelection } from "prosemirror-state";
import { EditorView, keymap as cmKeymap, ViewUpdate } from "@codemirror/view";
import { EditorState as CMEditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { createThemeExtension, detectDarkTheme } from "./code-block";
import { loadLanguageExtension, peekLanguageExtension } from "./editor-languages";
import { createViewGroupedRegistry } from "./view-registry";
import { classifyTag, sanitizeAttributes } from "../utils/html-sanitize";
import { resolveImageSrc } from "../utils/image-path";

// HTML 块实例按所属视图分组（模块级 Set 会让多实例互相干扰）
const htmlBlockViews = createViewGroupedRegistry<HtmlBlockView>();

/**
 * 更新「该视图下」所有 HTML 块的编辑状态
 */
export function updateAllHtmlBlocks(view: ProseMirrorView): void {
  const { from, to } = view.state.selection;
  for (const htmlView of htmlBlockViews.forOwner(view)) {
    htmlView.updateEditingState(from, to);
  }
}

/**
 * 递归清理 DOM 节点（策略见 `utils/html-sanitize.ts`，这里只做 DOM 遍历与摘除）。
 *
 * - `drop`：整块移除
 * - `unwrap`：拆壳保内容（未知 / 自定义标签在预览里不渲染，但内容不丢）
 * - `keep`：属性按白名单重写（先全删再回填，避免在 attributes 实时集合上边遍历边改）
 */
function sanitizeNode(node: Node): void {
  const removals: ChildNode[] = [];
  const unwraps: Element[] = [];

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;

    switch (classifyTag(el.tagName.toLowerCase())) {
      case "drop":
        removals.push(child);
        continue;
      case "unwrap":
        unwraps.push(el);
        break;
      default:
        break;
    }

    const kept = sanitizeAttributes(
      Array.from(el.attributes).map((attr) => ({ name: attr.name, value: attr.value }))
    );
    for (const attr of Array.from(el.attributes)) {
      el.removeAttribute(attr.name);
    }
    for (const attr of kept) {
      el.setAttribute(attr.name, attr.value);
    }

    sanitizeNode(child);
  }

  for (const child of removals) {
    child.remove();
  }
  for (const el of unwraps) {
    el.replaceWith(...el.childNodes);
  }
}

/**
 * 对 HTML 内容进行安全处理（DOM 解析 + 白名单过滤）
 */
function sanitizeHtml(htmlContent: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(htmlContent, "text/html");
  sanitizeNode(doc.body);
  doc.body.querySelectorAll("img[src]").forEach((img) => {
    const src = img.getAttribute("src");
    if (src) {
      img.setAttribute("src", resolveImageSrc(src));
    }
  });
  const fragment = document.createDocumentFragment();
  while (doc.body.firstChild) {
    fragment.appendChild(doc.body.firstChild);
  }
  return fragment;
}

/**
 * HTML 块 NodeView
 */
export class HtmlBlockView implements NodeView {
  dom: HTMLElement;
  private cm: EditorView;
  private node: ProseMirrorNode;
  private view: ProseMirrorView;
  private getPos: () => number | undefined;
  private updating = false;
  private isEditing = false;
  private preview: HTMLElement;
  private header: HTMLElement;
  private editorContainer: HTMLElement;
  private themeCompartment: Compartment;
  private languageCompartment: Compartment;
  private themeObserver: MutationObserver | null = null;
  /** HTML 语言包是动态 import 的：用代次计数丢弃过期结果，用 destroyed 挡住销毁后的回调 */
  private languageLoadToken = 0;
  private destroyed = false;

  constructor(node: ProseMirrorNode, view: ProseMirrorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.themeCompartment = new Compartment();
    this.languageCompartment = new Compartment();
    htmlBlockViews.add(view, this);

    const isDark = detectDarkTheme();

    // 创建容器
    this.dom = document.createElement("div");
    this.dom.className = "milkup-html-block";
    this.applyInlineHtmlClass(node);

    // 创建 header（固定显示 "HTML"）
    this.header = document.createElement("div");
    this.header.className = "milkup-html-block-header";
    const label = document.createElement("span");
    label.className = "milkup-html-block-label";
    label.textContent = "HTML";
    this.header.appendChild(label);
    this.dom.appendChild(this.header);

    // 创建预览区域
    this.preview = document.createElement("div");
    this.preview.className = "milkup-html-block-preview";
    this.dom.appendChild(this.preview);

    // 创建编辑器容器
    this.editorContainer = document.createElement("div");
    this.editorContainer.className = "milkup-html-block-editor";
    this.dom.appendChild(this.editorContainer);

    // 创建 CodeMirror 编辑器
    this.cm = new EditorView({
      state: CMEditorState.create({
        doc: node.textContent,
        extensions: [
          history(),
          cmKeymap.of([
            {
              key: "Ctrl-Enter",
              run: () => {
                this.exitBlock(1);
                return true;
              },
            },
            {
              key: "ArrowDown",
              run: (cmView) => {
                const { main } = cmView.state.selection;
                const line = cmView.state.doc.lineAt(main.head);
                if (line.number === cmView.state.doc.lines) {
                  this.exitBlock(1);
                  return true;
                }
                return false;
              },
            },
            {
              key: "ArrowUp",
              run: (cmView) => {
                const { main } = cmView.state.selection;
                const line = cmView.state.doc.lineAt(main.head);
                if (line.number === 1) {
                  this.exitBlock(-1);
                  return true;
                }
                return false;
              },
            },
            {
              key: "Backspace",
              run: (cmView) => {
                if (cmView.state.doc.length === 0) {
                  this.deleteBlock();
                  return true;
                }
                return false;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          this.themeCompartment.of(createThemeExtension(isDark)),
          // HTML 语言包按需加载，先挂空扩展，加载完成后 reconfigure
          this.languageCompartment.of([]),
          EditorView.updateListener.of((update) => this.onCMUpdate(update)),
          EditorView.domEventHandlers({
            focus: () => this.forwardSelection(),
          }),
        ],
      }),
      parent: this.editorContainer,
    });

    // HTML 语言包按需加载：拿到之后就挂上去
    this.applyHtmlLanguage();

    // 初始渲染
    this.updatePreview(node.textContent);
    this.setEditing(false);

    // 点击预览区域进入编辑模式
    this.preview.addEventListener("click", () => this.enterEditMode());

    // 初始检查光标位置
    const { from, to } = view.state.selection;
    this.updateEditingState(from, to);

    // 监听主题变化
    this.setupThemeObserver();
  }

  private updatePreview(content: string): void {
    this.preview.innerHTML = "";
    if (content.trim()) {
      const fragment = sanitizeHtml(content);
      this.preview.appendChild(fragment);
    } else {
      this.preview.innerHTML = '<span class="html-placeholder">输入 HTML...</span>';
    }
  }

  updateEditingState(selFrom: number, selTo: number): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;

    const nodeEnd = pos + node.nodeSize;
    const cursorInNode = selFrom >= pos && selTo <= nodeEnd;

    if (cursorInNode && !this.isEditing) {
      this.setEditing(true);
    } else if (!cursorInNode && this.isEditing) {
      this.setEditing(false);
    }
  }

  private setEditing(editing: boolean): void {
    this.isEditing = editing;
    if (editing) {
      this.dom.classList.add("editing");
      this.header.style.display = "";
      this.editorContainer.style.display = "";
      this.preview.style.display = "none";
    } else {
      this.dom.classList.remove("editing");
      this.header.style.display = "none";
      this.editorContainer.style.display = "none";
      this.preview.style.display = "";
      // 更新预览
      this.updatePreview(this.node.textContent);
    }
  }

  private enterEditMode(): void {
    if (this.isEditing) return;
    this.setEditing(true);
    const pos = this.getPos();
    if (pos !== undefined) {
      const tr = this.view.state.tr.setSelection(
        Selection.near(this.view.state.doc.resolve(pos + 1))
      );
      this.view.dispatch(tr);
      this.view.focus();
    }
  }

  private onCMUpdate(update: ViewUpdate): void {
    if (this.updating) return;
    if (update.docChanged) {
      const pos = this.getPos();
      if (pos === undefined) return;
      const newText = update.state.doc.toString();
      const tr = this.view.state.tr;
      const start = pos + 1;
      const end = pos + 1 + this.node.content.size;
      tr.replaceWith(start, end, newText ? this.view.state.schema.text(newText) : []);
      this.view.dispatch(tr);
    }
  }

  private forwardSelection(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const { from, to } = this.cm.state.selection.main;
    const start = pos + 1 + from;
    const end = pos + 1 + to;
    const selection = TextSelection.create(this.view.state.doc, start, end);
    if (!this.view.state.selection.eq(selection)) {
      this.view.dispatch(this.view.state.tr.setSelection(selection));
    }
  }

  private exitBlock(direction: 1 | -1): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const { state } = this.view;
    const nodeEnd = pos + this.node.nodeSize;

    if (direction === 1) {
      if (nodeEnd >= state.doc.content.size) {
        const paragraph = state.schema.nodes.paragraph.create();
        const tr = state.tr.insert(nodeEnd, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, nodeEnd + 1));
        this.view.dispatch(tr);
        this.view.focus();
        return;
      }
      const selection = Selection.near(state.doc.resolve(nodeEnd), 1);
      this.view.dispatch(state.tr.setSelection(selection));
      this.view.focus();
    } else {
      const selection = Selection.near(state.doc.resolve(pos), -1);
      if (selection.from >= pos) {
        const paragraph = state.schema.nodes.paragraph.create();
        const tr = state.tr.insert(pos, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, pos + 1));
        this.view.dispatch(tr);
        this.view.focus();
        return;
      }
      this.view.dispatch(state.tr.setSelection(selection));
      this.view.focus();
    }
  }

  private deleteBlock(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const { state } = this.view;
    const nodeEnd = pos + this.node.nodeSize;
    const tr = state.tr.delete(pos, nodeEnd);
    if (tr.doc.content.size === 0) {
      const paragraph = state.schema.nodes.paragraph.create();
      tr.insert(0, paragraph);
      tr.setSelection(TextSelection.create(tr.doc, 1));
    } else {
      const $pos = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
      tr.setSelection(Selection.near($pos, -1));
    }
    this.view.dispatch(tr);
    this.view.focus();
  }

  /**
   * 挂上 HTML 语法高亮（语言包按需 import，因此是异步的）。
   *
   * 竞态保护：NodeView 可能在加载完成前被销毁，用代次计数 + destroyed 挡住过期回调。
   */
  private applyHtmlLanguage(): void {
    const cached = peekLanguageExtension("html");
    if (cached) {
      this.cm.dispatch({ effects: this.languageCompartment.reconfigure(cached) });
      return;
    }

    const token = ++this.languageLoadToken;
    void loadLanguageExtension("html").then((extension) => {
      if (token !== this.languageLoadToken || this.destroyed) return;
      this.cm.dispatch({ effects: this.languageCompartment.reconfigure(extension) });
    });
  }

  private setupThemeObserver(): void {
    this.themeObserver = new MutationObserver(() => {
      const isDark = detectDarkTheme();
      this.cm.dispatch({
        effects: this.themeCompartment.reconfigure(createThemeExtension(isDark)),
      });
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== "html_block") return false;
    this.node = node;
    const newText = node.textContent;
    this.applyInlineHtmlClass(node);

    if (newText !== this.cm.state.doc.toString()) {
      this.updating = true;
      this.cm.dispatch({
        changes: { from: 0, to: this.cm.state.doc.length, insert: newText },
      });
      this.updating = false;
    }

    // 更新预览（仅在非编辑模式下）
    if (!this.isEditing) {
      this.updatePreview(newText);
    }

    return true;
  }

  setSelection(anchor: number, head: number): void {
    if (!this.isEditing) {
      this.setEditing(true);
    }
    this.cm.focus();
    this.cm.dispatch({ selection: { anchor, head } });
  }

  selectNode(): void {
    this.setEditing(true);
    this.cm.focus();
  }

  deselectNode(): void {
    // 由 updateEditingState 统一处理
  }

  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  /**
   * 根据内容更新 HTML 块的显示样式
   * - 有内容时添加 has-content 类，隐藏外框直接显示渲染结果
   * - 空内容时保留外框（显示占位提示）
   * - 简单自闭合标签添加 inline-html 类
   */
  private applyInlineHtmlClass(node: ProseMirrorNode): void {
    const content = node.textContent.trim();
    // 匹配纯自闭合标签：<tagname /> 或 <tagname/> 或 <tagname attr />
    const isSimpleVoid = /^<\w+(?:\s+[^>]*)?\s*\/?>$/.test(content) && !content.includes("\n");
    this.dom.classList.toggle("inline-html", isSimpleVoid);
    // 有内容时隐藏外框
    this.dom.classList.toggle("has-content", content.length > 0);
  }

  destroy(): void {
    this.destroyed = true;
    htmlBlockViews.remove(this.view, this);
    this.cm.destroy();
    if (this.themeObserver) {
      this.themeObserver.disconnect();
    }
  }
}

/**
 * 创建 HTML 块 NodeView
 */
export function createHtmlBlockNodeView(
  node: ProseMirrorNode,
  view: ProseMirrorView,
  getPos: () => number | undefined
): NodeView {
  return new HtmlBlockView(node, view, getPos);
}
