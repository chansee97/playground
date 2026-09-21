/**
 * NodeView 集合与源码视图状态的「按视图隔离」注册表。
 *
 * 背景（真 bug，不是隐患）：这些集合原本是模块级单例，于是同页放两个编辑器时，
 * A 编辑器的行为会作用到 B：
 *   - `updateAllMathBlocks(A.view)` 把 A 的选区灌给**所有**公式块 → B 的公式块跟着进出编辑态；
 *   - `sourceViewManager.setState()` 全局广播 → A 切源码视图会让 B 的列表/代码块 NodeView 换样式。
 *
 * 这里统一按 owner（`EditorView` 实例）分组。用 WeakMap 作容器：视图销毁后分组自然被回收，
 * 不需要额外的清理协议（NodeView 的 `destroy` 仍会把自己摘出去）。
 */

/** 空分组：只读共享，避免每次查询都分配一个新集合 */
const EMPTY_GROUP: ReadonlySet<never> = new Set();

export interface ViewGroupedRegistry<T> {
  /** 把实例登记到它所属的视图下 */
  add(owner: object, item: T): void;
  /** 从所属视图下摘除（视图已销毁时传原 owner 仍安全） */
  remove(owner: object, item: T): void;
  /** 取该视图下的实例集合；没有则返回空集合，可直接 for…of */
  forOwner(owner: object): ReadonlySet<T>;
}

/** 创建一个按视图分组的注册表 */
export function createViewGroupedRegistry<T>(): ViewGroupedRegistry<T> {
  const groups = new WeakMap<object, Set<T>>();

  return {
    add(owner, item) {
      let group = groups.get(owner);
      if (!group) {
        group = new Set();
        groups.set(owner, group);
      }
      group.add(item);
    },

    remove(owner, item) {
      groups.get(owner)?.delete(item);
    },

    forOwner(owner) {
      return groups.get(owner) ?? EMPTY_GROUP;
    },
  };
}

/** 源码视图状态变化监听器 */
export type SourceViewListener = (sourceView: boolean) => void;

/**
 * 源码视图状态（每个编辑器视图一份）。
 *
 * 状态的**唯一真相**是 decoration 插件的 plugin state（`DecorationPluginState.sourceView`）；
 * 这里只负责把「状态变化」推给该视图下的订阅者——因为 plugin state 的变化不保证触发
 * `NodeView.update`（节点本身没变），而 NodeView 需要用 source-view 类名切换 DOM 形态。
 * 推送时机由 decoration 插件的 `view.update` 钩子负责（见 `decorations/index.ts`）。
 */
const sourceViewStates = new WeakMap<object, boolean>();
const sourceViewListeners = new WeakMap<object, Set<SourceViewListener>>();

export const sourceViewRegistry = {
  /** 订阅某个视图的源码视图状态；订阅时立即用当前值回调一次 */
  subscribe(owner: object, listener: SourceViewListener): () => void {
    let listeners = sourceViewListeners.get(owner);
    if (!listeners) {
      listeners = new Set();
      sourceViewListeners.set(owner, listeners);
    }
    listeners.add(listener);
    listener(sourceViewStates.get(owner) ?? false);

    return () => {
      listeners.delete(listener);
    };
  },

  /** 更新某个视图的状态并只通知它的订阅者 */
  setState(owner: object, sourceView: boolean): void {
    sourceViewStates.set(owner, sourceView);
    const listeners = sourceViewListeners.get(owner);
    if (!listeners) return;
    for (const listener of listeners) listener(sourceView);
  },
};
