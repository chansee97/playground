import { resolve } from 'node:path'
import type { ConfigEnv } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import { setVitePlugins } from './vite.plugins.ts'

// https://vitejs.dev/config/
export default defineConfig(({ mode }: ConfigEnv) => {
  // 在开发环境下 command 的值为 serve 生产环境下为 build

  // 根据当前工作目录中的 `mode` 加载 .env 文件
  // 设置第三个参数为 '' 来加载所有环境变量，而不管是否有 `VITE_` 前缀。
  const env = loadEnv(mode, import.meta.dirname, '')

  return {
    base: env.VITE_BASE_URL,
    resolve: {
      alias: {
        '@': resolve(import.meta.dirname, 'src'),
      },
    },
    server: {
      host: '0.0.0.0',
    },
    build: {
      reportCompressedSize: false, // 启用/禁用 gzip 压缩大小报告
    },
    plugins: setVitePlugins(),
    // 说明：这里不再列任何演示包专属的 optimizeDeps。
    // 演示包的依赖由各自包声明（pnpm 严格隔离），而 optimizeDeps.include 是按
    // Vite root（本主包）解析的，主包解析不到演示包私有的依赖，写了只会产生
    // "Failed to resolve dependency" 警告。演示包内用 `?worker` 等方式导入的资源
    // 由 Vite 自行处理，无需在这里登记。
  }
})
