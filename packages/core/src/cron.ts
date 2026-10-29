import { Cron, Option } from "effect"

const HOUR = 60 * 60 * 1000

const cronNext = Option.liftThrowable(Cron.next)

/**
 * The first slot strictly after `now`, or undefined if the expression never matches a date. When clocks fall back,
 * Cron.next maps a repeated wall-clock time to its first occurrence, which is already past during the repeated hour,
 * so no slot fires twice: step past each such slot until one lands after `now`.
 */
export const nextCron = (cron: Cron.Cron, now: number, from = now): number | undefined => {
  const next = cronNext(cron, new Date(from))
  if (Option.isNone(next)) return undefined
  const at = next.value.getTime()
  return at > now ? at : nextCron(cron, now, at + HOUR)
}
