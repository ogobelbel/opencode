import type { SessionInfo } from "@opencode/client/promise"

/** Routine sessions carry `metadata.routine`; older ones only have the `Routine: ` title prefix. */
export function isRoutineSession(session: Pick<SessionInfo, "title" | "metadata">) {
  if (session.metadata?.routine !== undefined) return true

  return session.title?.startsWith("Routine: ") ?? false
}
