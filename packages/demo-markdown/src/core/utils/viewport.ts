/**
 * 视口（滚动容器）位置工具。
 *
 * 内核里有两处会「整篇替换文档」的操作：源码视图切换与 `setMarkdown`。
 * 整篇替换会让浏览器把滚动位置重置（光标所在的元素被重建），表现为「视野突然跳走」。
 * 两者都需要「先把光标在滚动容器里的偏移记下来，替换后补回去」，因此统一收口到这里。
 */
import type { EditorView } from "prosemirror-view";

/** 宿主的滚动层（约定类名 `.scrollView`，同编辑器其它模块） */
function findScrollView(view: EditorView): HTMLElement | null {
  const scrollView = view.dom.closest(".scrollView");
  return scrollView instanceof HTMLElement ? scrollView : null;
}

/** 光标相对滚动容器顶部的偏移；拿不到布局（未挂载 / 无滚动层）时返回 null */
export function getSelectionViewportOffset(view: EditorView): number | null {
  const scrollView = findScrollView(view);
  if (!scrollView) return null;

  try {
    const cursorCoords = view.coordsAtPos(view.state.selection.head);
    return cursorCoords.top - scrollView.getBoundingClientRect().top;
  } catch {
    return null;
  }
}

/** 视口补偿的最大轮数（每轮都要读布局，会触发强制同步布局，不宜多） */
const VIEWPORT_RESTORE_MAX_PASSES = 3;

/**
 * 把光标拉回原来的视口偏移。
 *
 * 为什么不是「无脑补 3 轮」：每轮都要读 `getBoundingClientRect` / `coordsAtPos`，
 * 会强制同步布局。第 1 轮之后已经对齐（且第 2 轮复核仍对齐）就没必要再补；
 * 只有确实还存在偏移时才继续追，最多 3 轮（用来吸收首轮测量未稳定/异步布局的位移）。
 */
export function restoreSelectionViewportOffset(view: EditorView, previousOffset: number, pass = 1): void {
  requestAnimationFrame(() => {
    if (!view.dom.isConnected) return;

    const scrollView = findScrollView(view);
    if (!scrollView) return;

    let delta = Number.NaN;
    try {
      const cursorCoords = view.coordsAtPos(view.state.selection.head);
      delta = cursorCoords.top - scrollView.getBoundingClientRect().top - previousOffset;
    } catch {
      // 测量失败（布局尚未就绪）：当作仍有偏移，落到下面再补一轮
    }

    if (!Number.isNaN(delta)) {
      if (Math.abs(delta) < 0.5) {
        // 已对齐：第 2 轮复核仍对齐就收工，不再空转
        if (pass >= 2) return;
      } else {
        scrollView.scrollTop += delta;
      }
    }

    if (pass < VIEWPORT_RESTORE_MAX_PASSES) {
      restoreSelectionViewportOffset(view, previousOffset, pass + 1);
    }
  });
}
