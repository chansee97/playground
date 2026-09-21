/**
 * Milkup 插件导出
 */

export {
  createInstantRenderPlugin,
  instantRenderPluginKey,
  enableInstantRender,
  disableInstantRender,
  toggleInstantRender,
  getInstantRenderState,
  getActiveRegionsFromState,
  type InstantRenderState,
  type InstantRenderConfig,
} from "./instant-render";

export { createInputRulesPlugin } from "./input-rules";
export {
  createBlockquoteAlertKeymapPlugin,
  createBlockquoteAlertSyncPlugin,
  blockquoteAlertKeymapPluginKey,
  blockquoteAlertSyncPluginKey,
} from "./blockquote-alert-sync";
export { createPlaceholderPlugin, placeholderPluginKey } from "./placeholder";
export { createLineNumbersPlugin, lineNumbersPluginKey } from "./line-numbers";
export { createSyntaxFixerPlugin, syntaxFixerPluginKey } from "./syntax-fixer";
export { createSyntaxDetectorPlugin, syntaxDetectorPluginKey } from "./syntax-detector";
export { createHeadingSyncPlugin, headingSyncPluginKey } from "./heading-sync";
export { createSourceViewTransformPlugin } from "./source-view-transform";
