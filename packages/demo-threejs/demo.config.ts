/**
 * 演示包自描述信息，由主包的 `demos.ts` 聚合。
 *
 * `routesFolder` 使用「相对仓库根」的路径，由主包解析为绝对路径后交给
 * vue-router 的文件路由插件（其 `src` 会经过 `path.resolve`，支持绝对路径）。
 */
export default {
  /** 演示标识（英文） */
  name: 'threejs',
  /** 菜单/页面标题 */
  label: 'ThreeJs',
  /** 路由页面目录（相对仓库根） */
  routesFolder: 'packages/demo-threejs/src/pages',
}
