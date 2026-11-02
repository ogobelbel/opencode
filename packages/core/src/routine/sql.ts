import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Permission } from "@opencode/schema/permission"
import type { Routine } from "@opencode/schema/routine"
import { Timestamps } from "../database/schema.sql.js"

export const RoutineTable = sqliteTable(
  "routine",
  {
    id: text().$type<Routine.ID>().primaryKey(),
    /** Absolute project directory; routines are not tied to a Session. */
    directory: text().notNull(),
    project_id: text().notNull(),
    title: text().notNull(),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    when: text({ mode: "json" }).$type<Routine.When>().notNull(),
    prompt: text().notNull(),
    mode: text().$type<Routine.Mode>().notNull(),
    model: text({ mode: "json" }).$type<Routine.Model>().notNull(),
    permissions: text({ mode: "json" }).$type<Permission.Ruleset>(),
    worktree: integer({ mode: "boolean" }).notNull().default(false),
    timeout_seconds: integer(),
    max_parallel: integer(),
    tags: text({ mode: "json" }).$type<readonly string[]>().notNull(),
    last_run_at: integer(),
    next_run_at: integer(),
    last_session_id: text(),
    ...Timestamps,
  },
  (table) => [
    index("routine_directory_idx").on(table.directory),
    index("routine_next_run_idx")
      .on(table.next_run_at)
      .where(sql`${table.enabled} = 1 and ${table.next_run_at} is not null`),
  ],
)

export const RoutineRunTable = sqliteTable(
  "routine_run",
  {
    id: text().$type<Routine.RunID>().primaryKey(),
    routine_id: text()
      .$type<Routine.ID>()
      .notNull()
      .references(() => RoutineTable.id, { onDelete: "cascade" }),
    session_id: text(),
    status: text().$type<Routine.RunStatus>().notNull().default("queued"),
    error: text(),
    worktree_path: text(),
    branch: text(),
    diff: text({ mode: "json" }).$type<Routine.Diff>(),
    summary: text(),
    time_created: integer().notNull(),
    time_started: integer(),
    time_completed: integer(),
  },
  (table) => [
    index("routine_run_routine_idx").on(table.routine_id, table.time_created),
    index("routine_run_status_idx").on(table.status),
  ],
)
