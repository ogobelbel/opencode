import { Routine } from "@opencode/core/routine"
import { InvalidRequestError, RoutineNotFoundError, RoutineRunNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiSchema } from "effect/http-api"

/** `experimental.routine.*` in the `server.experimental` group. */
export const makeRoutine = Effect.gen(function* () {
  const routines = yield* Routine.Service

  return {
    list: (query: { readonly directory?: string }) =>
      routines.list(query).pipe(Effect.map((data) => ({ data }))),
    create: (payload: Routine.CreateInput) =>
      routines
        .create(payload)
        .pipe(Effect.map((data) => ({ data })), Effect.catchTag("Routine.InvalidError", invalid)),
    get: (id: Routine.ID) =>
      routines.get(id).pipe(Effect.mapError(notFound), Effect.map((data) => ({ data }))),
    update: (id: Routine.ID, payload: Routine.UpdateInput) =>
      routines
        .update(id, payload)
        .pipe(
          Effect.map((data) => ({ data })),
          Effect.catchTags({ "Routine.InvalidError": invalid, "Routine.NotFoundError": notFound }),
        ),
    remove: (id: Routine.ID) =>
      routines
        .remove(id)
        .pipe(Effect.mapError(notFound), Effect.as(HttpApiSchema.NoContent.make())),
    run: (id: Routine.ID) =>
      routines.runNow(id).pipe(Effect.mapError(notFound), Effect.map((data) => ({ data }))),
    duplicate: (id: Routine.ID) =>
      routines
        .duplicate(id)
        .pipe(
          Effect.map((data) => ({ data })),
          Effect.catchTags({ "Routine.InvalidError": invalid, "Routine.NotFoundError": notFound }),
        ),
    runs: (input: { readonly routineID: Routine.ID; readonly limit?: number }) =>
      routines.listRuns(input).pipe(Effect.mapError(notFound), Effect.map((data) => ({ data }))),
    getRun: (id: Routine.RunID) =>
      routines.getRun(id).pipe(Effect.mapError(runNotFound), Effect.map((data) => ({ data }))),
    cancelRun: (id: Routine.RunID) =>
      routines.cancelRun(id).pipe(Effect.mapError(runNotFound), Effect.map((data) => ({ data }))),
  }
})

function notFound(error: Routine.NotFoundError) {
  return new RoutineNotFoundError({ routineID: error.routineID, message: error.message })
}

function runNotFound(error: Routine.RunNotFoundError) {
  return new RoutineRunNotFoundError({ runID: error.runID, message: error.message })
}

function invalid(error: Routine.InvalidError) {
  return new InvalidRequestError({ message: error.message, kind: "routine" })
}
