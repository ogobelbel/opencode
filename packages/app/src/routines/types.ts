export type RoutineMode = "yolo" | "read_only"

export type RoutineModel = {
  providerID: string
  modelID: string
  variant?: string
}

export type Routine = {
  id: string
  directory: string
  projectID: string
  title: string
  enabled: boolean
  when: { cron: string; tz: string }
  prompt: string
  mode: RoutineMode
  model: RoutineModel
  timeoutSeconds?: number
  maxParallel?: number
  tags: string[]
  lastRunAt?: string
  nextRunAt?: string
  lastSessionID?: string
  time: { created: string; updated: string }
}

export type RoutineRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped"

export type RoutineRun = {
  id: string
  routineID: string
  sessionID?: string
  status: RoutineRunStatus
  error?: string
  worktreePath?: string
  branch?: string
  diff?: { additions: number; deletions: number; files: number }
  time: { created: string; started?: string; completed?: string }
}
