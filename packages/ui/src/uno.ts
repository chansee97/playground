import type { UserConfig } from 'unocss'
import { presetAttributify, presetIcons, presetWind3, transformerVariantGroup } from 'unocss'

/**
 * 全站统一的原子化 CSS 配置。
 *
 * 主包的 `unocss.config.ts` 直接消费它，保证所有演示的原子类、
 * 快捷方式与图标渲染默认值保持一致。
 */
export function playgroundUno(): UserConfig {
  return {
    presets: [
      // presetUno 已在 UnoCSS 66 中重命名为 presetWind3
      presetWind3(),
      presetAttributify(),
      presetIcons({
        scale: 1.2,
        warn: true,
        extraProperties: {
          'display': 'inline-block',
          'vertical-align': 'middle',
        },
      }),
    ],
    shortcuts: {
      'wh-full': 'w-full h-full',
      'flex-center': 'flex justify-center items-center',
      'flex-col-center': 'flex-center flex-col',
    },
    safelist: [],
    transformers: [
      transformerVariantGroup(),
    ],
  }
}
