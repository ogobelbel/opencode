const HOUR = 60 * 60 * 1000

const DAY = 24 * HOUR

// DeepSeek's peak windows, in UTC hours, half-open like the published schedule: a window ends at its last hour.
const PEAK = [
  [1, 4],
  [6, 10],
] as const

// Every hour a window starts or ends, so the next change is the earliest one in the future.
const BOUNDARIES = PEAK.flat()

const weekday = (day: number) => day >= 1 && day <= 5

/**
 * DeepSeek's token pricing right now: peak weekdays 01:00-04:00 and 06:00-10:00 UTC, off-peak everywhere else.
 * Chinese public holidays are not excluded, so a weekday holiday still counts as peak between those hours.
 */
export function deepseekRate(now: Date) {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60

  const peak =
    weekday(now.getUTCDay()) && PEAK.some(([start, end]) => minutes >= start * 60 && minutes < end * 60)

  return { peak, nextChange: nextChange(now) }
}

/** The first boundary after `now`. A weekday always falls inside the eight days searched, so one is always found. */
function nextChange(now: Date) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  const candidates = [0, 1, 2, 3, 4, 5, 6, 7]
    .filter((offset) => weekday(new Date(midnight + offset * DAY).getUTCDay()))
    .flatMap((offset) => BOUNDARIES.map((hour) => midnight + offset * DAY + hour * HOUR))

  return Math.min(...candidates.filter((time) => time > now.getTime()))
}
