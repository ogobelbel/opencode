import { afterEach, expect, setSystemTime, test } from "bun:test"
import { deepseekRate } from "./off-peak"

afterEach(() => setSystemTime())

// 2026-10-26 is a Monday; 2026-10-30 a Friday; 2026-10-31 a Saturday.
const cases = [
  { at: "2026-10-26T00:30:00Z", peak: false, next: "2026-10-26T01:00:00Z" },
  { at: "2026-10-26T01:00:00Z", peak: true, next: "2026-10-26T04:00:00Z" },
  { at: "2026-10-26T03:59:59Z", peak: true, next: "2026-10-26T04:00:00Z" },
  { at: "2026-10-26T04:00:00Z", peak: false, next: "2026-10-26T06:00:00Z" },
  { at: "2026-10-26T05:30:00Z", peak: false, next: "2026-10-26T06:00:00Z" },
  { at: "2026-10-26T09:30:00Z", peak: true, next: "2026-10-26T10:00:00Z" },
  { at: "2026-10-26T10:00:00Z", peak: false, next: "2026-10-27T01:00:00Z" },
  { at: "2026-10-30T10:00:00Z", peak: false, next: "2026-11-02T01:00:00Z" },
  { at: "2026-10-30T09:00:00Z", peak: true, next: "2026-10-30T10:00:00Z" },
  { at: "2026-10-31T02:00:00Z", peak: false, next: "2026-11-02T01:00:00Z" },
  { at: "2026-11-01T07:00:00Z", peak: false, next: "2026-11-02T01:00:00Z" },
  { at: "2026-11-02T00:00:00Z", peak: false, next: "2026-11-02T01:00:00Z" },
] as const

for (const item of cases) {
  test(`${item.at} is ${item.peak ? "peak" : "off-peak"} until ${item.next}`, () => {
    const now = new Date(item.at)
    setSystemTime(now)

    const rate = deepseekRate(now)

    expect(rate.peak).toBe(item.peak)
    expect(rate.nextChange).toBe(Date.parse(item.next))
  })
}
