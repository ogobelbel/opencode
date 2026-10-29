import { Routine } from "@opencode/schema/routine"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import { InvalidRequestError, RoutineNotFoundError, RoutineRunNotFoundError } from "../errors.js"

const root = "/api/experimental/routine"
const params = { routineID: Routine.ID }
const runParams = { runID: Routine.RunID }
const notFound = [RoutineNotFoundError] as const
const runNotFound = [RoutineRunNotFoundError] as const
const EXPERIMENTAL = "Experimental: may change without compatibility guarantees."

const annotations = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.routine.${identifier}`,
    summary,
    description: `${description} ${EXPERIMENTAL}`,
  })

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const RoutineEndpoints = [
  HttpApiEndpoint.get("experimental.routine.list", root, {
    query: Schema.Struct({ directory: Schema.String.pipe(Schema.optional) }),
    success: Schema.Struct({ data: Schema.Array(Routine.Info) }),
  }).annotateMerge(
    annotations("list", "List routines", "List every routine on the server, optionally narrowed to one project directory."),
  ),
  HttpApiEndpoint.post("experimental.routine.create", root, {
    payload: Routine.CreateInput,
    success: Schema.Struct({ data: Routine.Info }),
    error: [InvalidRequestError],
  }).annotateMerge(annotations("create", "Create routine", "Create a routine that starts a new Session on a cron.")),
  HttpApiEndpoint.get("experimental.routine.get", `${root}/:routineID`, {
    params,
    success: Schema.Struct({ data: Routine.Info }),
    error: notFound,
  }).annotateMerge(annotations("get", "Get routine", "Read one routine.")),
  HttpApiEndpoint.patch("experimental.routine.update", `${root}/:routineID`, {
    params,
    payload: Routine.UpdateInput,
    success: Schema.Struct({ data: Routine.Info }),
    error: [InvalidRequestError, RoutineNotFoundError],
  }).annotateMerge(
    annotations("update", "Update routine", "Update a routine. Re-enabling it reschedules from the current time."),
  ),
  HttpApiEndpoint.delete("experimental.routine.delete", `${root}/:routineID`, {
    params,
    success: HttpApiSchema.NoContent,
    error: notFound,
  }).annotateMerge(annotations("delete", "Delete routine", "Delete a routine and its run history.")),
  HttpApiEndpoint.post("experimental.routine.run", `${root}/:routineID/run`, {
    params,
    success: Schema.Struct({ data: Routine.Run }),
    error: notFound,
  }).annotateMerge(annotations("run", "Run routine now", "Queue a run immediately, honouring maxParallel.")),
  HttpApiEndpoint.post("experimental.routine.duplicate", `${root}/:routineID/duplicate`, {
    params,
    success: Schema.Struct({ data: Routine.Info }),
    error: [InvalidRequestError, RoutineNotFoundError],
  }).annotateMerge(annotations("duplicate", "Duplicate routine", "Copy a routine with a new id and a new schedule.")),
  HttpApiEndpoint.get("experimental.routine.runs", `${root}/:routineID/runs`, {
    params,
    query: Schema.Struct({
      limit: Schema.NumberFromString.pipe(
        Schema.decodeTo(Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(200))),
        Schema.optional,
      ),
    }),
    success: Schema.Struct({ data: Schema.Array(Routine.Run) }),
    error: notFound,
  }).annotateMerge(annotations("runs", "List routine runs", "List a routine's runs, newest first.")),
  HttpApiEndpoint.get("experimental.routine.getRun", `${root}/run/:runID`, {
    params: runParams,
    success: Schema.Struct({ data: Routine.Run }),
    error: runNotFound,
  }).annotateMerge(annotations("getRun", "Get routine run", "Read one run.")),
  HttpApiEndpoint.post("experimental.routine.cancelRun", `${root}/run/:runID/cancel`, {
    params: runParams,
    success: Schema.Struct({ data: Routine.Run }),
    error: runNotFound,
  }).annotateMerge(annotations("cancelRun", "Cancel routine run", "Mark a queued or running run cancelled.")),
] as const
