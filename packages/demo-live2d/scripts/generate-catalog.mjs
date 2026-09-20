/**
 * 从 Eikanya/Live2d-model 生成模型清单（src/models.generated.json）。
 *
 * 清单里直接存好「完整 CDN URL」与「显示名」，运行时不拼路径、不做 encodeURI：
 * 路径里的中文、空格、括号都在这里一次性处理掉。
 *
 * 为什么走 git 而不是 HTTP 接口（都实测过）：
 * - jsDelivr 的文件列表接口对该仓库直接 403：Package size exceeded the configured limit of 50 MB
 * - GitHub 的 git/trees?recursive=1 返回 truncated: true（仓库 10 万+ 文件被截断，只拿到 102 个模型）
 * - 而部分克隆（--filter=blob:none --no-checkout）只取目录树、不下载任何模型文件：
 *   实测约 17s、3 MB，且不受接口限流影响
 *
 * 用法：pnpm --filter @playground/demo-live2d catalog
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SOURCE = 'https://github.com/Eikanya/Live2d-model.git'
const MODEL_ROOT = 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/'
const OUTPUT = resolve(import.meta.dirname, '../src/models.generated.json')

const workDir = mkdtempSync(join(tmpdir(), 'live2d-catalog-'))

try {
  console.log(`[catalog] 部分克隆（只取目录树，不下载模型文件）：${SOURCE}`)
  execFileSync('git', [
    'clone',
    '--filter=blob:none',
    '--no-checkout',
    '--depth',
    '1',
    SOURCE,
    workDir,
  ], { stdio: 'inherit' })

  const ref = execFileSync('git', ['-C', workDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

  // core.quotepath=false：否则中文路径会被转义成八进制
  const listing = execFileSync(
    'git',
    ['-c', 'core.quotepath=false', '-C', workDir, 'ls-tree', '-r', '--name-only', 'HEAD'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )

  const paths = listing.split('\n').filter(Boolean)
  const model3 = paths.filter(path => path.endsWith('.model3.json'))
  const model2 = paths.filter(path => path.endsWith('.model.json'))

  // 一级目录（各游戏）分组。每个模型先攒出「由短到长的候选标签」，
  // 组内同名的再逐级往前加目录，直到能区分。
  const groups = new Map()
  for (const path of model3) {
    const segments = path.split('/')
    const file = segments.at(-1) ?? ''
    const [group] = segments
    /** 游戏目录之后的各级目录 */
    const directories = segments.slice(1, -1)
    /** 去掉扩展名的文件名；有 23 个模型的文件名就是 `.model3.json`，此时退回用所在目录名 */
    const name = file.replace(/\.model3\.json$/, '') || directories.at(-1) || group
    /** 文件名与所在目录同名时不必重复显示 */
    const showName = name !== directories.at(-1)

    // 候选标签 = 路径尾部的后缀，由短到长：先试文件名，再逐级加父目录，
    // 最后用「相对游戏目录的完整路径」兜底（含真实文件名，必然唯一）
    const tail = showName ? [...directories, name] : [...directories]
    const candidates = []
    for (let index = tail.length - 1; index >= 0; index--)
      candidates.push(tail.slice(index).join('/'))

    candidates.push(segments.slice(1).join('/'))

    const models = groups.get(group) ?? []
    models.push({ candidates, url: MODEL_ROOT + encodeURI(path) })
    groups.set(group, models)
  }

  const catalogGroups = [...groups].map(([label, models]) => {
    // 候选标签在全组出现的次数；为 1 说明只有它自己用得上
    const usage = new Map()
    for (const model of models) {
      for (const candidate of model.candidates)
        usage.set(candidate, (usage.get(candidate) ?? 0) + 1)
    }

    return {
      label,
      models: models.map(model => ({
        // 取「最短且全组唯一」的候选；都不唯一时用完整相对路径（必然唯一）
        label: model.candidates.find(candidate => usage.get(candidate) === 1) ?? model.candidates.at(-1),
        url: model.url,
      })),
    }
  })

  const catalog = {
    source: SOURCE.replace(/\.git$/, ''),
    ref,
    generatedAt: new Date().toISOString(),
    /** 本演示可加载的模型（Cubism 3/4/5） */
    cubism3: model3.length,
    /** Cubism 2 模型：需要 legacy 运行时，本演示用的是 /cubism 入口，故排除 */
    cubism2Excluded: model2.length,
    groups: catalogGroups,
  }

  // 生成物不进代码评审，紧凑输出即可（体积约减半）
  writeFileSync(OUTPUT, `${JSON.stringify(catalog)}\n`, 'utf8')

  console.log(`[catalog] 已写入 ${OUTPUT}`)
  console.log(`[catalog] Cubism 3/4/5：${model3.length} 个（${catalog.groups.length} 个分组）；Cubism 2（已排除）：${model2.length} 个`)
  console.log(`[catalog] 仓库版本：${ref.slice(0, 7)}`)
}
finally {
  rmSync(workDir, { recursive: true, force: true })
}
