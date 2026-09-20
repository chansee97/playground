import type { Router } from 'vue-router'
import { demos } from '../demos'

export interface MenuItem {
  label: string
  key: string
  /** 有 path 的项渲染成路由链接，没有的渲染成纯文本（分组标题） */
  path?: string
  children?: MenuItem[]
}

/** index 文件生成的路由路径带尾斜杠（如 /tableExport/），统一去掉后再比较 */
function normalizePath(path: string) {
  return path.replace(/\/$/, '')
}

/**
 * 由路由表推导菜单。
 *
 * 演示包无需在别处登记菜单：只要在页面的 `<route>` 块里写上 `meta.title`，
 * 主包就会按「演示名 = 路由前缀」把它归组到对应演示下；只有一个页面且路径
 * 就是前缀本身的演示，会直接作为单个菜单项。
 */
export function buildMenu(router: Router): MenuItem[] {
  const titledRoutes = router.getRoutes()
    .filter(route => route.meta.title)

  return demos.flatMap((demo): MenuItem[] => {
    const prefix = `/${demo.name}`
    const matched = titledRoutes
      .filter(route => normalizePath(route.path) === prefix
        || normalizePath(route.path).startsWith(`${prefix}/`))
      .toSorted((a, b) => normalizePath(a.path).localeCompare(normalizePath(b.path)))

    if (!matched.length)
      return []

    // 单页面演示：直接是一个菜单项
    if (matched.length === 1 && normalizePath(matched[0].path) === prefix) {
      return [{
        label: String(matched[0].meta.title),
        key: prefix,
        path: prefix,
      }]
    }

    // 多页面演示：一个分组 + 各页面子项
    return [{
      label: demo.label,
      key: demo.name,
      children: matched.map(route => ({
        label: String(route.meta.title),
        key: normalizePath(route.path),
        path: normalizePath(route.path),
      })),
    }]
  })
}
