import { defineConfig } from 'vitest/config'

/**
 * 内核测试只需 Node 环境：
 * parser / serializer / schema 全部不依赖 DOM，
 * 依赖 DOM 的部分（editor、nodeviews）不在单测范围内。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 让 `?raw` 能拿到样式表原文：默认 css:false 会把所有 CSS 导入（含 ?raw）替换成空串，
    // 样式契约测试就失去了意义。
    css: true,
  },
})
