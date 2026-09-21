/**
 * 动态 Keymap 插件
 *
 * 使用 ProseMirror 的 keydownHandler 处理按键事件，
 * 支持动态更新快捷键绑定。通过缓存机制避免重复构建。
 */

import { Plugin, type Command } from "prosemirror-state";
import { Schema } from "prosemirror-model";
import { keydownHandler } from "prosemirror-keymap";
import { buildActionCommandMap } from "./action-commands";
import { DEFAULT_SHORTCUTS } from "./shortcut-registry";
import type { ShortcutKeyMap } from "./types";

/**
 * 快捷键配置来源：把「读配置」收口成一个**可失效的稳定快照**。
 *
 * 原来的热路径是「每次按键都 `getCustomKeyMap()`（读 localStorage + JSON.parse），
 * 再 `JSON.stringify` 比对」——两次 JSON 处理全压在必须同步完成的 keydown 上。
 * 这里改成：
 *   - `get()` 在未失效前返回**同一个对象引用**，于是动态 keymap 只需一次身份比较；
 *   - 宿主改完配置调用 `invalidate()`，下一次按键才重新读取。
 */
export function createShortcutConfigSource(read: () => ShortcutKeyMap): {
  get: () => ShortcutKeyMap;
  invalidate: () => void;
} {
  let snapshot: ShortcutKeyMap | null = null;
  return {
    get(): ShortcutKeyMap {
      if (!snapshot) snapshot = read() ?? {};
      return snapshot;
    },
    invalidate(): void {
      snapshot = null;
    },
  };
}

/**
 * 把自定义映射展开成 ProseMirror 的 key → command 绑定。
 *
 * 缺省（`undefined`）回落到默认键；显式置空（`null` / `""`）表示解绑。
 */
export function buildShortcutBindings(
  customMap: ShortcutKeyMap,
  commands: Record<string, Command | undefined>
): Record<string, Command> {
  const bindings: Record<string, Command> = {};

  for (const shortcut of DEFAULT_SHORTCUTS) {
    const customKey = customMap[shortcut.id];
    const boundKey = customKey === undefined ? shortcut.defaultKey : customKey;
    const command = commands[shortcut.id];
    if (command && boundKey) bindings[boundKey] = command;
  }

  return bindings;
}

/**
 * 创建动态 Keymap 插件
 *
 * @param schema - ProseMirror Schema
 * @param getCustomKeyMap - 获取用户自定义快捷键映射的回调。
 *   调用方需保证「配置未变时返回同一对象引用」（见 `createShortcutConfigSource`），
 *   否则每次按键都会重建 handler。
 */
export function createDynamicKeymapPlugin(
  schema: Schema,
  getCustomKeyMap: () => ShortcutKeyMap
): Plugin {
  const commandMap = buildActionCommandMap(schema);

  // 缓存：配置对象引用未变化时复用 handler。
  // 用身份比较而不是 JSON 序列化对比——这是每次按键都要走的路径。
  let lastCustomMap: ShortcutKeyMap | null = null;
  let cachedHandler: ((view: any, event: KeyboardEvent) => boolean) | null = null;

  function getHandler() {
    const customMap = getCustomKeyMap() ?? {};

    if (customMap !== lastCustomMap || !cachedHandler) {
      lastCustomMap = customMap;

      // 使用 ProseMirror 的 keydownHandler，确保与原生 keymap 完全一致的按键匹配
      cachedHandler = keydownHandler(buildShortcutBindings(customMap, commandMap));
    }

    return cachedHandler!;
  }

  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        return getHandler()(view, event);
      },
    },
  });
}
