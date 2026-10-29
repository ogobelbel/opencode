import type { Routine, RoutineRun } from "./types"

export type RoutineProject = { projectID: string; directory: string }

export const demoProjects: RoutineProject[] = [
  { projectID: "prj_opencode", directory: "/Users/you/code/opencode" },
  { projectID: "prj_website", directory: "/Users/you/code/website" },
  { projectID: "prj_api", directory: "/Users/you/code/api" },
]

export const demoRoutines: Routine[] = [
  {
    id: "routine_dependency_audit",
    directory: "/Users/you/code/opencode",
    projectID: "prj_opencode",
    title: "Nightly dependency audit",
    enabled: true,
    when: { cron: "0 3 * * *", tz: "UTC" },
    prompt:
      "Audit the dependency tree for security advisories and outdated packages. Open a worktree, apply safe upgrades, and summarize the changes.",
    mode: "yolo",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-5", variant: "high" },
    timeoutSeconds: 1800,
    maxParallel: 1,
    tags: ["maintenance", "security"],
    lastRunAt: "2026-10-29T03:00:12Z",
    nextRunAt: "2026-10-30T03:00:00Z",
    lastSessionID: "ses_01j9f3k2a7",
    time: { created: "2026-09-12T18:24:00Z", updated: "2026-10-29T03:12:00Z" },
  },
  {
    id: "routine_release_notes",
    directory: "/Users/you/code/website",
    projectID: "prj_website",
    title: "Morning release notes",
    enabled: true,
    when: { cron: "30 8 * * 1-5", tz: "Europe/Berlin" },
    prompt:
      "Read yesterday's merged pull requests, group them by area, and draft release notes in the changelog. Do not publish anything.",
    mode: "read_only",
    model: { providerID: "openai", modelID: "gpt-5.1", variant: "medium" },
    timeoutSeconds: 900,
    tags: ["docs", "release"],
    lastRunAt: "2026-10-29T07:30:04Z",
    nextRunAt: "2026-10-30T07:30:00Z",
    lastSessionID: "ses_01j9f4m8b1",
    time: { created: "2026-10-02T11:05:00Z", updated: "2026-10-29T07:41:00Z" },
  },
  {
    id: "routine_flaky_tests",
    directory: "/Users/you/code/api",
    projectID: "prj_api",
    title: "Weekly flaky test sweep",
    enabled: false,
    when: { cron: "0 14 * * 5", tz: "UTC" },
    prompt:
      "Find tests that failed intermittently this week, reproduce them locally, and prepare fixes with a short explanation.",
    mode: "yolo",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
    timeoutSeconds: 2400,
    maxParallel: 2,
    tags: ["tests", "quality"],
    nextRunAt: "2026-11-06T14:00:00Z",
    time: { created: "2026-10-11T09:48:00Z", updated: "2026-10-25T14:02:00Z" },
  },
]

export const demoRuns: RoutineRun[] = [
  {
    id: "run_01j9f3k2a7",
    routineID: "routine_dependency_audit",
    sessionID: "ses_01j9f3k2a7",
    status: "completed",
    worktreePath: "/Users/you/code/opencode/.worktrees/routine-dependency-audit",
    branch: "routine/dependency-audit",
    diff: { additions: 42, deletions: 7, files: 3 },
    time: {
      created: "2026-10-29T03:00:00Z",
      started: "2026-10-29T03:00:12Z",
      completed: "2026-10-29T03:12:00Z",
    },
  },
  {
    id: "run_01j9eyk1c4",
    routineID: "routine_dependency_audit",
    status: "failed",
    error: "Timed out while running the lockfile update.",
    time: {
      created: "2026-10-28T03:00:00Z",
      started: "2026-10-28T03:00:09Z",
      completed: "2026-10-28T03:30:09Z",
    },
  },
  {
    id: "run_01j9eyk1c0",
    routineID: "routine_dependency_audit",
    sessionID: "ses_01j9eyk1c0",
    status: "completed",
    branch: "routine/dependency-audit",
    diff: { additions: 8, deletions: 8, files: 1 },
    time: {
      created: "2026-10-27T03:00:00Z",
      started: "2026-10-27T03:00:08Z",
      completed: "2026-10-27T03:09:40Z",
    },
  },
  {
    id: "run_01j9f4m8b1",
    routineID: "routine_release_notes",
    sessionID: "ses_01j9f4m8b1",
    status: "completed",
    diff: { additions: 31, deletions: 2, files: 2 },
    time: {
      created: "2026-10-29T07:30:00Z",
      started: "2026-10-29T07:30:04Z",
      completed: "2026-10-29T07:41:00Z",
    },
  },
  {
    id: "run_01j9f4m8b2",
    routineID: "routine_release_notes",
    status: "skipped",
    time: { created: "2026-10-28T07:30:00Z" },
  },
  {
    id: "run_01j9f5q3d6",
    routineID: "routine_flaky_tests",
    sessionID: "ses_01j9f5q3d6",
    status: "running",
    worktreePath: "/Users/you/code/api/.worktrees/routine-flaky-tests",
    branch: "routine/flaky-test-sweep",
    time: { created: "2026-10-25T14:00:00Z", started: "2026-10-25T14:00:06Z" },
  },
]
