import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Database } from "@opencode/core/database/database"
import { Project } from "@opencode/core/project"
import { Routine } from "@opencode/core/routine"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Routine.node]), [
    Project.node.replace(
      Layer.mock(Project.Service, {
        resolve: (directory) => Effect.succeed({ id: Project.ID.global, directory, canonical: directory }),
      }),
    ),
  ]),
)

const setTime = (iso: string) => TestClock.setTime(Date.parse(iso))
const iso = (millis: number | undefined) => (millis === undefined ? undefined : new Date(millis).toISOString())

const input = (overrides: Partial<Routine.CreateInput> = {}): Routine.CreateInput => ({
  directory: "/project",
  title: "Nightly check",
  when: { cron: "0 9 * * *", tz: "UTC" },
  prompt: "check the build",
  mode: "yolo",
  model: { providerID: "openai", modelID: "gpt-5" },
  ...overrides,
})

describe("Routine", () => {
  it.effect("creates, lists, updates, duplicates and removes a routine", () =>
    Effect.gen(function* () {
      yield* setTime("2026-01-01T00:00:00Z")
      const routines = yield* Routine.Service

      const routine = yield* routines.create(input({ tags: ["ci"] }))
      expect(routine.id.startsWith("aut_")).toBe(true)
      expect(routine).toMatchObject({
        directory: "/project",
        projectID: Project.ID.global,
        title: "Nightly check",
        enabled: true,
        mode: "yolo",
        tags: ["ci"],
        time: { created: Date.parse("2026-01-01T00:00:00Z") },
      })
      expect(iso(routine.nextRunAt)).toBe("2026-01-01T09:00:00.000Z")
      expect(yield* routines.list()).toEqual([routine])
      expect(yield* routines.list({ directory: "/other" })).toEqual([])
      expect(yield* routines.get(routine.id)).toEqual(routine)

      const paused = yield* routines.update(routine.id, { enabled: false, title: "Paused" })
      expect(paused).toMatchObject({ enabled: false, title: "Paused", nextRunAt: undefined })

      const resumed = yield* routines.update(routine.id, { enabled: true })
      expect(iso(resumed.nextRunAt)).toBe("2026-01-01T09:00:00.000Z")

      const copy = yield* routines.duplicate(routine.id)
      expect(copy.id).not.toBe(routine.id)
      expect(copy.title).toBe("Paused (copy)")

      yield* routines.remove(copy.id)
      expect(yield* Effect.flip(routines.get(copy.id))).toMatchObject({ _tag: "Routine.NotFoundError" })
    }),
  )

  it.effect("rejects an unknown time zone, a relative directory and a never-firing cron", () =>
    Effect.gen(function* () {
      yield* setTime("2026-01-01T00:00:00Z")
      const routines = yield* Routine.Service
      expect(
        yield* Effect.flip(routines.create(input({ when: { cron: "0 9 * * *", tz: "Mars/Olympus" } }))),
      ).toMatchObject({ _tag: "Routine.InvalidError" })
      expect(
        yield* Effect.flip(routines.create(input({ directory: "relative/path" }))),
      ).toMatchObject({ _tag: "Routine.InvalidError" })
      expect(
        yield* Effect.flip(routines.create(input({ when: { cron: "0 9 31 2 *", tz: "UTC" } }))),
      ).toMatchObject({ _tag: "Routine.InvalidError" })
    }),
  )

  it.effect("computes the next run in Europe/Warsaw across both DST changes", () =>
    Effect.gen(function* () {
      const routines = yield* Routine.Service

      // Spring forward on 2026-03-29: 09:30 Warsaw is 07:30Z instead of 08:30Z.
      yield* setTime("2026-03-28T12:00:00Z")
      const spring = yield* routines.create(input({ when: { cron: "30 9 * * *", tz: "Europe/Warsaw" } }))
      expect(iso(spring.nextRunAt)).toBe("2026-03-29T07:30:00.000Z")

      // Fall back on 2026-10-25: 09:30 Warsaw is 08:30Z instead of 07:30Z.
      yield* setTime("2026-10-24T12:00:00Z")
      const autumn = yield* routines.create(input({ when: { cron: "30 9 * * *", tz: "Europe/Warsaw" } }))
      expect(iso(autumn.nextRunAt)).toBe("2026-10-25T08:30:00.000Z")

      yield* setTime("2026-10-25T08:30:00Z")
      yield* routines.tick
      expect(iso((yield* routines.get(autumn.id)).nextRunAt)).toBe("2026-10-26T08:30:00.000Z")
    }),
  )

  it.effect("queues one run per due slot", () =>
    Effect.gen(function* () {
      yield* setTime("2026-02-01T00:00:00Z")
      const routines = yield* Routine.Service
      const routine = yield* routines.create(input())

      yield* setTime("2026-02-01T09:00:00Z")
      yield* routines.tick
      const runs = yield* routines.listRuns({ routineID: routine.id })
      expect(runs).toHaveLength(1)
      expect(runs[0]).toMatchObject({
        routineID: routine.id,
        status: "queued",
        time: { created: Date.parse("2026-02-01T09:00:00Z") },
      })
      expect(runs[0]!.id.startsWith("run_")).toBe(true)
      expect(yield* routines.getRun(runs[0]!.id)).toEqual(runs[0])

      const fired = yield* routines.get(routine.id)
      expect(iso(fired.lastRunAt)).toBe("2026-02-01T09:00:00.000Z")
      expect(iso(fired.nextRunAt)).toBe("2026-02-02T09:00:00.000Z")

      yield* routines.tick
      expect(yield* routines.listRuns({ routineID: routine.id })).toHaveLength(1)
    }),
  )

  it.effect("skips a slot while a run is still active", () =>
    Effect.gen(function* () {
      yield* setTime("2026-02-01T09:00:00Z")
      const routines = yield* Routine.Service
      const routine = yield* routines.create(input({ when: { cron: "0 * * * *", tz: "UTC" } }))
      yield* routines.tick

      yield* setTime("2026-02-01T10:00:00Z")
      yield* routines.tick
      expect(yield* routines.listRuns({ routineID: routine.id })).toHaveLength(1)
      expect(iso((yield* routines.get(routine.id)).nextRunAt)).toBe("2026-02-01T11:00:00.000Z")

      const manual = yield* routines.runNow(routine.id)
      expect(manual.id).toBe((yield* routines.listRuns({ routineID: routine.id }))[0]!.id)

      const cancelled = yield* routines.cancelRun(manual.id)
      expect(cancelled.status).toBe("cancelled")
      const next = yield* routines.runNow(routine.id)
      expect(next.id).not.toBe(manual.id)
      expect((yield* routines.listRuns({ routineID: routine.id })).map((run) => run.status)).toEqual([
        "queued",
        "cancelled",
      ])
    }),
  )

  it.effect("does not fire a disabled routine", () =>
    Effect.gen(function* () {
      yield* setTime("2026-02-01T00:00:00Z")
      const routines = yield* Routine.Service
      const routine = yield* routines.create(input({ enabled: false }))
      expect(routine.nextRunAt).toBeUndefined()

      yield* setTime("2026-02-02T09:00:00Z")
      yield* routines.tick
      expect(yield* routines.listRuns({ routineID: routine.id })).toEqual([])

      yield* routines.update(routine.id, { enabled: true })
      yield* routines.update(routine.id, { enabled: false })
      yield* setTime("2026-02-03T09:00:00Z")
      yield* routines.tick
      expect(yield* routines.listRuns({ routineID: routine.id })).toEqual([])
    }),
  )

  it.effect("drops a slot that is more than an hour overdue", () =>
    Effect.gen(function* () {
      yield* setTime("2026-02-01T00:00:00Z")
      const routines = yield* Routine.Service
      const routine = yield* routines.create(input())

      yield* setTime("2026-02-01T10:30:00Z")
      yield* routines.tick
      expect(yield* routines.listRuns({ routineID: routine.id })).toEqual([])
      expect(iso((yield* routines.get(routine.id)).nextRunAt)).toBe("2026-02-02T09:00:00.000Z")
    }),
  )
})
