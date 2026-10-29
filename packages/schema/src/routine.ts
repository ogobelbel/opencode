export * as Routine from "./routine.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { NonNegativeInt, PositiveInt, optional, statics } from "./schema.js"

export const ID = Schema.String.check(Schema.isStartingWith("aut_")).pipe(
  Schema.brand("Routine.ID"),
  Schema.annotate({ identifier: "Routine.ID" }),
  statics((schema) => ({
    create: () => schema.make("aut_" + ascending()),
  })),
)
export type ID = typeof ID.Type

export const RunID = Schema.String.check(Schema.isStartingWith("run_")).pipe(
  Schema.brand("Routine.RunID"),
  Schema.annotate({ identifier: "Routine.RunID" }),
  statics((schema) => ({
    create: () => schema.make("run_" + ascending()),
  })),
)
export type RunID = typeof RunID.Type

/** A five-field cron expression, read in the next_run_at zone below. */
export const When = Schema.Struct({
  cron: Schema.String.annotate({ description: 'A five-field cron expression, for example "0 9 * * 1-5".' }),
  tz: Schema.String.annotate({ description: "IANA time zone the cron is read in." }),
}).annotate({ identifier: "Routine.When" })
export interface When extends Schema.Schema.Type<typeof When> {}

export const Mode = Schema.Literals(["yolo", "read_only"]).annotate({ identifier: "Routine.Mode" })
export type Mode = typeof Mode.Type

export const Model = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  variant: optional(Schema.String),
}).annotate({ identifier: "Routine.Model" })
export interface Model extends Schema.Schema.Type<typeof Model> {}

export const RunStatus = Schema.Literals(["queued", "running", "completed", "failed", "cancelled", "skipped"]).annotate({
  identifier: "Routine.RunStatus",
})
export type RunStatus = typeof RunStatus.Type

export const Diff = Schema.Struct({
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  files: NonNegativeInt,
}).annotate({ identifier: "Routine.Diff" })
export interface Diff extends Schema.Schema.Type<typeof Diff> {}

export const Time = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
}).annotate({ identifier: "Routine.Time" })
export interface Time extends Schema.Schema.Type<typeof Time> {}

export const RunTime = Schema.Struct({
  created: NonNegativeInt,
  started: optional(NonNegativeInt),
  completed: optional(NonNegativeInt),
}).annotate({ identifier: "Routine.RunTime" })
export interface RunTime extends Schema.Schema.Type<typeof RunTime> {}

export const Info = Schema.Struct({
  id: ID,
  directory: Schema.String.annotate({ description: "Absolute path of the project the routine runs in." }),
  projectID: Schema.String,
  title: Schema.String,
  enabled: Schema.Boolean,
  when: When,
  prompt: Schema.String,
  mode: Mode,
  model: Model,
  /** Run in a fresh git worktree instead of `directory`. Defaults to false. */
  worktree: optional(Schema.Boolean),
  timeoutSeconds: optional(PositiveInt),
  maxParallel: optional(PositiveInt).annotate({ description: "Active runs allowed at once. Defaults to 1." }),
  tags: Schema.Array(Schema.String),
  lastRunAt: optional(NonNegativeInt),
  nextRunAt: optional(NonNegativeInt),
  lastSessionID: optional(Schema.String),
  time: Time,
}).annotate({ identifier: "Routine.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Run = Schema.Struct({
  id: RunID,
  routineID: ID,
  sessionID: optional(Schema.String),
  status: RunStatus,
  error: optional(Schema.String),
  worktreePath: optional(Schema.String),
  branch: optional(Schema.String),
  diff: optional(Diff),
  /** Text of the last assistant message, truncated for display. */
  summary: optional(Schema.String),
  time: RunTime,
}).annotate({ identifier: "Routine.Run" })
export interface Run extends Schema.Schema.Type<typeof Run> {}

export const CreateInput = Schema.Struct({
  directory: Schema.String.annotate({ description: "Absolute path of the project the routine runs in." }),
  title: Schema.String,
  enabled: optional(Schema.Boolean),
  when: When,
  prompt: Schema.String,
  mode: Mode,
  model: Model,
  worktree: optional(Schema.Boolean),
  timeoutSeconds: optional(PositiveInt),
  maxParallel: optional(PositiveInt),
  tags: optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "Routine.CreateInput" })
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}

export const UpdateInput = Schema.Struct({
  title: optional(Schema.String),
  enabled: optional(Schema.Boolean),
  when: optional(When),
  prompt: optional(Schema.String),
  mode: optional(Mode),
  model: optional(Model),
  worktree: optional(Schema.Boolean),
  timeoutSeconds: optional(PositiveInt),
  maxParallel: optional(PositiveInt),
  tags: optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "Routine.UpdateInput" })
export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
