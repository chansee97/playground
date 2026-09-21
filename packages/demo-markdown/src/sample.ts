/**
 * 演示用示例文档。
 *
 * 内容放在独立的 `sample.md` 里用 `?raw` 引入，而不是写成模板字符串：
 * 示例需要覆盖转义（`\*`）、反引号代码段、反斜杠硬换行等语法，
 * 放进模板字符串会被转义规则二次处理，非常容易写错。
 */
import raw from './sample.md?raw'

/** 统一换行符，保证与解析器内部归一化后的结果一致 */
export const sampleMarkdown = raw.replace(/\r\n?/g, '\n')
