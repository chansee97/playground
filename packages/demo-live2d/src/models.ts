import type { SelectGroupOption } from 'naive-ui'
import catalog from './models.generated.json'

/**
 * 清单信息。数据由 `pnpm --filter @playground/demo-live2d catalog` 生成，
 * 里面已经带好了完整 CDN URL（中文、空格等都已 encode），运行时不需要拼路径。
 */
export const catalogInfo = {
  source: catalog.source,
  ref: catalog.ref,
  generatedAt: catalog.generatedAt,
  total: catalog.cubism3,
  cubism2Excluded: catalog.cubism2Excluded,
}

/**
 * 按游戏分组的选项：选项显示 label（默认是文件名，同组内重名时已补上父目录），
 * 完整 URL 作为值。
 */
export function buildModelOptions(): SelectGroupOption[] {
  return catalog.groups.map(group => ({
    type: 'group' as const,
    label: group.label,
    key: group.label,
    children: group.models.map(model => ({ label: model.label, value: model.url })),
  }))
}

/** 默认选中的模型（清单第一项） */
export function getDefaultModelUrl() {
  return catalog.groups[0].models[0].url
}
