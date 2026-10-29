export * as Routine from "./routine.js"

import { and, asc, desc, eq, inArray, lte } from "drizzle-orm"
import { Clock, Context, Cron, DateTime, Effect, Layer, Option, Result, Schema } from "effect"
import { Node, makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Routine as RoutineSchema } from "@opencode/schema/routine"
import path from "path"
import { nextCron } from "./cron.js"
import { Database } from "./database/database.js"
import { Project } from "./project.js"
import { AbsolutePath } from "./schema.js"
import { RoutineRunTable, RoutineTable } from "./routine/sql.js"

export const ID = RoutineSchema.ID
export type ID = RoutineSchema.ID
export const RunID = RoutineSchema.RunID
export type RunID = RoutineSchema.RunID
export const Info = RoutineSchema.Info
export type Info = RoutineSchema.Info
export const Run = RoutineSchema.Run
export type Run = RoutineSchema.Run
export const CreateInput = RoutineSchema.CreateInput
export type CreateInput = RoutineSchema.CreateInput
export const UpdateInput = RoutineSchema.UpdateInput
export type UpdateInput = RoutineSchema.UpdateInput
export const Mode = RoutineSchema.Mode
export const RunStatus = RoutineSchema.RunStatus

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Routine.NotFoundError", {
  routineID: ID,
}) {
  override get message() {
    return `Routine not found: ${this.routineID}`
  }
}

export class RunNotFoundError extends Schema.TaggedError<RunNotFoundError>()("Routine.RunNotFoundError", {
  runID: RunID,
}) {
  override get message() {
    return `Routine run not found: ${this.runID}`
  }
}

export class InvalidError extends Schema.TaggedError<InvalidError>()("Routine.InvalidError", {
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info, InvalidError>
  readonly list: (input?: { readonly directory?: string }) => Effect.Effect<Info[]>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly update: (id: ID, input: UpdateInput) => Effect.Effect<Info, NotFoundError | InvalidError>
  readonly remove: (id: ID) => Effect.Effect<void, NotFoundError>
  readonly duplicate: (id: ID) => Effect.Effect<Info, NotFoundError | InvalidError>
  /** Queues a run immediately, ignoring the schedule but still honouring maxParallel. */
  readonly runNow: (id: ID) => Effect.Effect<Run, NotFoundError>
  readonly listRuns: (input: { readonly routineID: ID; readonly limit?: number }) => Effect.Effect<Run[], NotFoundError>
  readonly getRun: (id: RunID) => Effect.Effect<Run, RunNotFoundError>
  readonly cancelRun: (id: RunID) => Effect.Effect<Run, RunNotFoundError>
  /** Queues a run for every routine that is due now. Execution is P1. */
  readonly tick: Effect.Effect<void>
  /** Ticks on a fixed interval until interrupted; only the managed server runs this. */
  readonly run: Effect.Effect<never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Routine") {}

type Row = typeof RoutineTable.$inferSelect
type RunRow = typeof RoutineRunTable.$inferSelect

/** A firing further past its due time than this is dropped instead of catching up. */
const GRACE = 60 * 60 * 1000
const DEFAULT_PARALLEL = 1
const ACTIVE: readonly RoutineSchema.RunStatus[] = ["queued", "running"]

const optionalTime = (value: number | null) => (value === null ? undefined : value)

const toInfo = (row: Row): Info => ({
  id: row.id,
  directory: row.directory,
  projectID: row.project_id,
  title: row.title,
  enabled: row.enabled,
  when: row.when,
  prompt: row.prompt,
  mode: row.mode,
  model: row.model,
  timeoutSeconds: row.timeout_seconds ?? undefined,
  maxParallel: row.max_parallel ?? undefined,
  tags: row.tags,
  lastRunAt: optionalTime(row.last_run_at),
  nextRunAt: optionalTime(row.next_run_at),
  lastSessionID: row.last_session_id ?? undefined,
  time: { created: row.time_created, updated: row.time_updated },
})

const toRun = (row: RunRow): Run => ({
  id: row.id,
  routineID: row.routine_id,
  sessionID: row.session_id ?? undefined,
  status: row.status,
  error: row.error ?? undefined,
  worktreePath: row.worktree_path ?? undefined,
  branch: row.branch ?? undefined,
  diff: row.diff ?? undefined,
  time: {
    created: row.time_created,
    started: optionalTime(row.time_started),
    completed: optionalTime(row.time_completed),
  },
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const projects = yield* Project.Service

    const find = (id: ID) =>
      db
        .select()
        .from(RoutineTable)
        .where(eq(RoutineTable.id, id))
        .get()
        .pipe(
          Effect.orDie,
          Effect.flatMap((row) => (row ? Effect.succeed(row) : Effect.fail(new NotFoundError({ routineID: id })))),
        )

    const findRun = (id: RunID) =>
      db
        .select()
        .from(RoutineRunTable)
        .where(eq(RoutineRunTable.id, id))
        .get()
        .pipe(
          Effect.orDie,
          Effect.flatMap((row) => (row ? Effect.succeed(row) : Effect.fail(new RunNotFoundError({ runID: id })))),
        )

    const active = (routineID: ID) =>
      db
        .select({ id: RoutineRunTable.id })
        .from(RoutineRunTable)
        .where(and(eq(RoutineRunTable.routine_id, routineID), inArray(RoutineRunTable.status, ACTIVE)))
        .all()
        .pipe(Effect.orDie)

    const latest = (routineID: ID) =>
      db
        .select()
        .from(RoutineRunTable)
        .where(and(eq(RoutineRunTable.routine_id, routineID), inArray(RoutineRunTable.status, ACTIVE)))
        .orderBy(desc(RoutineRunTable.time_created))
        .get()
        .pipe(Effect.orDie)

    const cron = (when: RoutineSchema.When) =>
      Effect.gen(function* () {
        const zone = Option.getOrUndefined(DateTime.zoneMakeNamed(when.tz))
        if (zone === undefined) return yield* new InvalidError({ reason: `Unknown time zone: ${when.tz}` })
        const parsed = Cron.parse(when.cron, zone)
        if (Result.isFailure(parsed)) return yield* new InvalidError({ reason: parsed.failure.message })
        if (parsed.success.seconds.size !== 1)
          return yield* new InvalidError({ reason: "cron must fire at most once a minute" })
        return parsed.success
      })

    /** The first slot strictly after `now`; invalid expressions and never-firing schedules are rejected. */
    const nextFor = Effect.fnUntraced(function* (when: RoutineSchema.When, now: number) {
      const parsed = yield* cron(when)
      const next = nextCron(parsed, now)
      if (next === undefined) return yield* new InvalidError({ reason: `cron never fires: ${when.cron}` })
      return next
    })

    /** Stored rows were validated on create and update. */
    const following = (row: Row, now: number) => nextCron(Cron.parseUnsafe(row.when.cron, row.when.tz), now)

    // P1 owns run execution; for now nothing survives a restart in `running`, so mark those interrupted.
    const now = yield* Clock.currentTimeMillis
    yield* db
      .update(RoutineRunTable)
      .set({ status: "failed", error: "Interrupted by server restart", time_completed: now })
      .where(eq(RoutineRunTable.status, "running"))
      .run()
      .pipe(Effect.orDie)

    const queue = Effect.fnUntraced(function* (row: Row, now: number) {
      return yield* db
        .insert(RoutineRunTable)
        .values({ id: RunID.create(), routine_id: row.id, status: "queued", time_created: now })
        .returning()
        .get()
        .pipe(Effect.orDie, Effect.map(toRun))
    })

    const tickAt = Effect.fnUntraced(function* (now: number) {
      const due = yield* db
        .select()
        .from(RoutineTable)
        .where(and(eq(RoutineTable.enabled, true), lte(RoutineTable.next_run_at, now)))
        .orderBy(asc(RoutineTable.next_run_at))
        .all()
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        due,
        (row) =>
          Effect.gen(function* () {
            const next = following(row, now)
            const overdue = row.next_run_at !== null && now - row.next_run_at > GRACE
            const running = yield* active(row.id)
            // Skip a missed slot past the grace window, and skip an overlap rather than stacking runs.
            if (overdue || running.length >= (row.max_parallel ?? DEFAULT_PARALLEL)) {
              yield* db
                .update(RoutineTable)
                .set({ next_run_at: next ?? null, time_updated: now })
                .where(eq(RoutineTable.id, row.id))
                .run()
                .pipe(Effect.orDie)
              return
            }
            yield* queue(row, now)
            yield* db
              .update(RoutineTable)
              .set({ last_run_at: now, next_run_at: next ?? null, time_updated: now })
              .where(eq(RoutineTable.id, row.id))
              .run()
              .pipe(Effect.orDie)
          }),
        { discard: true },
      )
    }, Effect.withSpan("Routine.tick"))

    const tick = Effect.flatMap(Clock.currentTimeMillis, tickAt)

    const run = Effect.forever(
      Effect.gen(function* () {
        yield* tickAt(yield* Clock.currentTimeMillis).pipe(
          Effect.catchCause((cause) => Effect.logError("routine tick failed", { cause })),
        )
        yield* Effect.sleep(30_000)
      }),
    )

    return Service.of({
      create: Effect.fn("Routine.create")(function* (input) {
        const now = yield* Clock.currentTimeMillis
        const next = yield* nextFor(input.when, now)
        if (!path.isAbsolute(input.directory))
          return yield* new InvalidError({ reason: `Directory must be absolute: ${input.directory}` })
        const project = yield* projects.resolve(AbsolutePath.make(input.directory))
        const enabled = input.enabled ?? true
        const row = yield* db
          .insert(RoutineTable)
          .values({
            id: ID.create(),
            directory: input.directory,
            project_id: project.id,
            title: input.title,
            enabled,
            when: input.when,
            prompt: input.prompt,
            mode: input.mode,
            model: input.model,
            timeout_seconds: input.timeoutSeconds ?? null,
            max_parallel: input.maxParallel ?? null,
            tags: input.tags ?? [],
            next_run_at: enabled ? next : null,
            time_created: now,
            time_updated: now,
          })
          .returning()
          .get()
          .pipe(Effect.orDie)
        return toInfo(row)
      }),
      list: Effect.fn("Routine.list")(function* (input) {
        const rows = yield* db
          .select()
          .from(RoutineTable)
          .where(input?.directory === undefined ? undefined : eq(RoutineTable.directory, input.directory))
          .orderBy(asc(RoutineTable.time_created), asc(RoutineTable.id))
          .all()
          .pipe(Effect.orDie)
        return rows.map(toInfo)
      }),
      get: Effect.fn("Routine.get")(function* (id) {
        return toInfo(yield* find(id))
      }),
      update: Effect.fn("Routine.update")(function* (id, input) {
        const row = yield* find(id)
        const now = yield* Clock.currentTimeMillis
        const when = input.when ?? row.when
        const enabled = input.enabled ?? row.enabled
        const rescheduled = input.when !== undefined || (enabled && !row.enabled)
        const next = !enabled ? null : rescheduled ? yield* nextFor(when, now) : row.next_run_at
        const updated = yield* db
          .update(RoutineTable)
          .set({
            title: input.title ?? row.title,
            enabled,
            when,
            prompt: input.prompt ?? row.prompt,
            mode: input.mode ?? row.mode,
            model: input.model ?? row.model,
            timeout_seconds: input.timeoutSeconds ?? row.timeout_seconds,
            max_parallel: input.maxParallel ?? row.max_parallel,
            tags: input.tags ?? row.tags,
            next_run_at: next,
            time_updated: now,
          })
          .where(eq(RoutineTable.id, id))
          .returning()
          .get()
          .pipe(Effect.orDie)
        return toInfo(updated)
      }),
      remove: Effect.fn("Routine.remove")(function* (id) {
        yield* find(id)
        yield* db.delete(RoutineTable).where(eq(RoutineTable.id, id)).run().pipe(Effect.orDie)
      }),
      duplicate: Effect.fn("Routine.duplicate")(function* (id) {
        const row = yield* find(id)
        const now = yield* Clock.currentTimeMillis
        const next = row.enabled ? yield* nextFor(row.when, now) : null
        const copy = yield* db
          .insert(RoutineTable)
          .values({
            id: ID.create(),
            directory: row.directory,
            project_id: row.project_id,
            title: `${row.title} (copy)`,
            enabled: row.enabled,
            when: row.when,
            prompt: row.prompt,
            mode: row.mode,
            model: row.model,
            timeout_seconds: row.timeout_seconds,
            max_parallel: row.max_parallel,
            tags: row.tags,
            next_run_at: next,
            time_created: now,
            time_updated: now,
          })
          .returning()
          .get()
          .pipe(Effect.orDie)
        return toInfo(copy)
      }),
      runNow: Effect.fn("Routine.runNow")(function* (id) {
        const row = yield* find(id)
        const running = yield* active(id)
        if (running.length >= (row.max_parallel ?? DEFAULT_PARALLEL)) {
          const current = yield* latest(id)
          if (current) return toRun(current)
        }
        const now = yield* Clock.currentTimeMillis
        const run = yield* queue(row, now)
        yield* db
          .update(RoutineTable)
          .set({ last_run_at: now, time_updated: now })
          .where(eq(RoutineTable.id, id))
          .run()
          .pipe(Effect.orDie)
        return run
      }),
      listRuns: Effect.fn("Routine.listRuns")(function* (input) {
        yield* find(input.routineID)
        const rows = yield* db
          .select()
          .from(RoutineRunTable)
          .where(eq(RoutineRunTable.routine_id, input.routineID))
          .orderBy(desc(RoutineRunTable.time_created), desc(RoutineRunTable.id))
          .limit(input.limit ?? 50)
          .all()
          .pipe(Effect.orDie)
        return rows.map(toRun)
      }),
      getRun: Effect.fn("Routine.getRun")(function* (id) {
        return toRun(yield* findRun(id))
      }),
      cancelRun: Effect.fn("Routine.cancelRun")(function* (id) {
        const row = yield* findRun(id)
        if (row.status !== "queued" && row.status !== "running") return toRun(row)
        const now = yield* Clock.currentTimeMillis
        const updated = yield* db
          .update(RoutineRunTable)
          .set({ status: "cancelled", time_completed: now })
          .where(eq(RoutineRunTable.id, id))
          .returning()
          .get()
          .pipe(Effect.orDie)
        return toRun(updated)
      }),
      tick,
      run,
    })
  }),
)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, Project.node],
})
