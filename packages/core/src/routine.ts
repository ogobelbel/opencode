export * as Routine from "./routine.js"

import { and, asc, desc, eq, inArray, lte } from "drizzle-orm"
import { Cause, Clock, Context, Cron, DateTime, Duration, Effect, Exit, Layer, Option, Result, Schema } from "effect"
import { Node, makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Routine as RoutineSchema } from "@opencode/schema/routine"
import path from "path"
import { nextCron } from "./cron.js"
import { Database } from "./database/database.js"
import { Project } from "./project.js"
import { AbsolutePath } from "./schema.js"
import { Session } from "./session.js"
import { Worktree } from "./worktree.js"
import { Slug } from "./util/slug.js"
import { diffStats, modelRef, permissions, summary } from "./routine/execution.js"
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
const EXECUTOR_INTERVAL = 2_000
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
  permissions: row.permissions ?? undefined,
  worktree: row.worktree ? true : undefined,
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
  summary: row.summary ?? undefined,
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
    const sessions = yield* Session.Service
    const worktrees = yield* Worktree.Service

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

    const claim = (id: RunID, now: number) =>
      db
        .update(RoutineRunTable)
        .set({ status: "running", time_started: now })
        .where(and(eq(RoutineRunTable.id, id), eq(RoutineRunTable.status, "queued")))
        .returning()
        .get()
        .pipe(Effect.orDie)

    /** Terminal writes only apply while the run is still running, so a cancellation always wins. */
    const finish = (id: RunID, values: Partial<typeof RoutineRunTable.$inferInsert>) =>
      db
        .update(RoutineRunTable)
        .set(values)
        .where(and(eq(RoutineRunTable.id, id), eq(RoutineRunTable.status, "running")))
        .returning()
        .get()
        .pipe(Effect.orDie)

    const touchRoutine = (run: RunRow, now: number) =>
      db
        .update(RoutineTable)
        .set({
          last_run_at: now,
          time_updated: now,
          ...(run.session_id === null ? {} : { last_session_id: run.session_id }),
        })
        .where(eq(RoutineTable.id, run.routine_id))
        .run()
        .pipe(Effect.orDie)

    const errorText = (cause: Cause.Cause<unknown>) =>
      Cause.prettyErrors(cause)
        .map((error) => error.message)
        .filter((message) => message.length > 0)
        .join("\n") || "Routine run failed"

    const execute = Effect.fnUntraced(function* (run: RunRow) {
      const outcome = yield* Effect.gen(function* () {
        const routine = yield* find(run.routine_id)
        const worktree = routine.worktree
          ? yield* worktrees.create({
              projectID: Project.ID.make(routine.project_id),
              name: `routine-${Slug.create()}`,
            })
          : undefined
        yield* db
          .update(RoutineRunTable)
          .set({ worktree_path: worktree?.directory ?? null })
          .where(eq(RoutineRunTable.id, run.id))
          .run()
          .pipe(Effect.orDie)
        const session = yield* sessions.create({
          location: { directory: AbsolutePath.make(worktree ? worktree.directory : routine.directory) },
          title: `Routine: ${routine.title}`,
          model: modelRef(routine.model),
          permissions: permissions(routine.mode, routine.permissions ?? []),
          // Lets the inbox group routine sessions apart from normal work, even if the title is edited later.
          metadata: { routine: { id: routine.id, title: routine.title } },
        })
        yield* db
          .update(RoutineRunTable)
          .set({ session_id: session.id })
          .where(eq(RoutineRunTable.id, run.id))
          .run()
          .pipe(Effect.orDie)
        const current = yield* findRun(run.id)
        if (current.status !== "running") {
          yield* sessions.interrupt(session.id)
          return
        }
        yield* sessions.prompt({ sessionID: session.id, text: routine.prompt })
        const timeout = routine.timeout_seconds
        yield* timeout === null
          ? sessions.wait(session.id)
          : sessions.wait(session.id).pipe(
              Effect.timeoutOrElse({
                duration: Duration.seconds(timeout),
                orElse: () =>
                  Effect.gen(function* () {
                    yield* sessions.interrupt(session.id)
                    return yield* Effect.fail(new Error(`Routine timed out after ${timeout} seconds`))
                  }),
              }),
            )
        const messages = yield* sessions
          .messages({ sessionID: session.id, order: "desc", limit: 50 })
          .pipe(Effect.catchCause(() => Effect.succeed([])))
        const files = yield* sessions
          .diff({ sessionID: session.id })
          .pipe(Effect.catchCause(() => Effect.succeed([])))
        return {
          session,
          worktreePath: worktree?.directory,
          diff: diffStats(files),
          summary: summary(messages),
        }
      }).pipe(Effect.exit)

      const now = yield* Clock.currentTimeMillis
      if (Exit.isFailure(outcome)) {
        const failed = yield* finish(run.id, {
          status: "failed",
          error: errorText(outcome.cause),
          time_completed: now,
        })
        if (failed) yield* touchRoutine(failed, now)
        return
      }
      if (outcome.value === undefined) return
      const completed = yield* finish(run.id, {
        status: "completed",
        session_id: outcome.value.session.id,
        worktree_path: outcome.value.worktreePath ?? null,
        diff: outcome.value.diff,
        summary: outcome.value.summary ?? null,
        time_completed: now,
      })
      if (completed) yield* touchRoutine(completed, now)
    })

    const drain = Effect.fnUntraced(function* (now: number) {
      const queued = yield* db
        .select({
          id: RoutineRunTable.id,
          routine_id: RoutineRunTable.routine_id,
          max_parallel: RoutineTable.max_parallel,
        })
        .from(RoutineRunTable)
        .innerJoin(RoutineTable, eq(RoutineTable.id, RoutineRunTable.routine_id))
        .where(eq(RoutineRunTable.status, "queued"))
        .orderBy(asc(RoutineRunTable.time_created), asc(RoutineRunTable.id))
        .all()
        .pipe(Effect.orDie)
      if (queued.length === 0) return
      const running = yield* db
        .select({ routine_id: RoutineRunTable.routine_id })
        .from(RoutineRunTable)
        .where(eq(RoutineRunTable.status, "running"))
        .all()
        .pipe(Effect.orDie)
      const counts = new Map<string, number>()
      for (const row of running) counts.set(row.routine_id, (counts.get(row.routine_id) ?? 0) + 1)
      for (const item of queued) {
        const count = counts.get(item.routine_id) ?? 0
        if (count >= (item.max_parallel ?? DEFAULT_PARALLEL)) continue
        const claimed = yield* claim(item.id, now)
        if (claimed === undefined) continue
        counts.set(item.routine_id, count + 1)
        yield* Effect.forkScoped(execute(claimed))
      }
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

    const schedule = Effect.forever(
      Effect.gen(function* () {
        yield* tickAt(yield* Clock.currentTimeMillis).pipe(
          Effect.catchCause((cause) => Effect.logError("routine tick failed", { cause })),
        )
        yield* Effect.sleep(30_000)
      }),
    )

    // Queued rows are durable, so this also resumes work that was waiting when the server stopped.
    const executor = Effect.forever(
      Effect.gen(function* () {
        yield* drain(yield* Clock.currentTimeMillis).pipe(
          Effect.catchCause((cause) => Effect.logError("routine executor failed", { cause })),
        )
        yield* Effect.sleep(EXECUTOR_INTERVAL)
      }),
    )

    const run = Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.forkScoped(schedule)
        return yield* executor
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
            permissions: input.permissions ?? null,
            worktree: input.worktree ?? false,
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
            permissions: input.permissions ?? row.permissions,
            worktree: input.worktree ?? row.worktree,
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
            permissions: row.permissions,
            worktree: row.worktree,
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
        if (row.status === "running" && row.session_id !== null)
          yield* sessions.interrupt(Session.ID.make(row.session_id))
        const now = yield* Clock.currentTimeMillis
        const updated = yield* db
          .update(RoutineRunTable)
          .set({ status: "cancelled", time_completed: now })
          .where(and(eq(RoutineRunTable.id, id), inArray(RoutineRunTable.status, ACTIVE)))
          .returning()
          .get()
          .pipe(Effect.orDie)
        // A run that settled between the read and the update keeps its terminal status.
        return toRun(updated ?? (yield* findRun(id)))
      }),
      tick,
      run,
    })
  }),
)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, Project.node, Session.node, Worktree.node],
})
