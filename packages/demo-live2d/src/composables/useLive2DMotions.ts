import type { useMessage } from 'naive-ui'
import type { ShallowRef } from 'vue'
import { ref, watch } from 'vue'
import type { Live2DModelInstance } from '../loadEngine'

type MessageApi = ReturnType<typeof useMessage>

/** model3.json 中定义的动作 */
export interface MotionDefinition {
  File: string
}

/** 动作对象上读时长用的方法：字段都是可选的，所以任意对象都满足这个形状 */
interface DurationReadable {
  getLoopDuration?: () => number
  getDuration?: () => number
  getDurationMSec?: () => number
}

function isDurationReadable(value: unknown): value is DurationReadable {
  return typeof value === 'object' && value !== null
}

/**
 * 取动作一次循环的时长（秒）。
 * 循环动作的 `getDuration()` 返回 -1，必须用 `getLoopDuration()`；
 * Cubism 2 的动作则是 `getDurationMSec()` 返回毫秒。
 */
function getMotionDuration(motion: unknown) {
  if (!isDurationReadable(motion))
    return 0

  const loopSeconds = motion.getLoopDuration?.()
  if (loopSeconds && loopSeconds > 0)
    return loopSeconds

  const seconds = motion.getDuration?.()
  if (seconds && seconds > 0)
    return seconds

  const milliseconds = motion.getDurationMSec?.()
  return milliseconds && milliseconds > 0 ? milliseconds / 1000 : 0
}

/** 引擎的 definitions 只是 `unknown[]`，这里按 model3.json 的结构收窄 */
function toMotionGroups(definitions: Partial<Record<string, unknown[]>> | undefined) {
  const groups: Record<string, MotionDefinition[]> = {}

  for (const [group, items] of Object.entries(definitions ?? {})) {
    groups[group] = (items ?? []).flatMap((item) => {
      if (typeof item !== 'object' || item === null || !('File' in item) || typeof item.File !== 'string')
        return []

      return [{ File: item.File }]
    })
  }

  return groups
}

export interface UseLive2DMotionsOptions {
  /** 当前模型，切换后动作清单会自动刷新 */
  model: ShallowRef<Live2DModelInstance | null>
  /** 用于提示播放结果 */
  message: MessageApi
}

/** 动作播放：动作清单、播放调度、进度条状态 */
export function useLive2DMotions({ model, message }: UseLive2DMotionsOptions) {
  /** 动作组 → 动作定义 */
  const motions = ref<Record<string, MotionDefinition[]>>({})
  /** 进度条时长，形如 `4.067s`；空串表示当前没有在计时的动作 */
  const motionTime = ref('')
  /**
   * 每次播放自增，用于强制重建进度条元素。
   * 只改 animation-duration 并不会让 CSS 动画重新开始（浏览器只是按新时长重算进度），
   * 不重建元素的话，只有页面加载后的第一次播放能看到进度条。
   */
  const playId = ref(0)

  /** 上一个动作的清理定时器，避免它把新动作的时长清掉 */
  let timer: ReturnType<typeof setTimeout> | undefined

  watch(model, (current) => {
    motions.value = toMotionGroups(current?.internalModel.motionManager.definitions)
    clearTimeout(timer)
    motionTime.value = ''
  }, { immediate: true })

  async function playMotion(group: string, index: number) {
    const current = model.value
    if (!current)
      return

    const msg = message.loading('动作加载中...', { duration: 0 })

    // 先停掉正在播放的动作：循环动作会一直占着 NORMAL 优先级不放，
    // 不先停掉的话，后续任何 NORMAL 优先级的播放都会被调度直接拒绝（reserve 返回 false）。
    current.internalModel.motionManager.stopAllMotions()

    // 走官方入口：内部会按需加载动作，并按优先级调度
    const isSuccess = await current.motion(group, index)
    msg.destroy()

    if (!isSuccess) {
      message.error('加载失败')
      return
    }

    // 此时动作实例已存在于 motionGroups 中，可从中读取循环时长
    const duration = getMotionDuration(current.internalModel.motionManager.motionGroups[group]?.[index])
    if (duration > 0) {
      clearTimeout(timer)
      motionTime.value = `${duration}s`
      playId.value += 1
      timer = setTimeout(() => {
        motionTime.value = ''
      }, duration * 1000)
    }
    message.success('加载成功')
  }

  return { motions, motionTime, playId, playMotion }
}
