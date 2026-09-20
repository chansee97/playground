// 注意：这里只导出运行时代码。
// `uno.ts` 是构建期配置（引入 unocss），只能通过子路径 `@playground/ui/uno`
// 或相对路径在配置文件里使用，不能从入口导出，否则会被打进客户端产物。
export { default as AppProviders } from './components/AppProviders.vue'
