import { defineConfig } from 'unocss'
// 相对路径引用（配置由 Node 侧加载，workspace 包是 TS 源码无法被 Node 直接加载）
import { playgroundUno } from '../../packages/ui/src/uno.ts'

// https://github.com/antfu/unocss
export default defineConfig(playgroundUno())
