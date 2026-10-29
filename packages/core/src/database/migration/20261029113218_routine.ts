import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261029113218_routine",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`routine_run\` (
          \`id\` text PRIMARY KEY,
          \`routine_id\` text NOT NULL,
          \`session_id\` text,
          \`status\` text DEFAULT 'queued' NOT NULL,
          \`error\` text,
          \`worktree_path\` text,
          \`branch\` text,
          \`diff\` text,
          \`summary\` text,
          \`time_created\` integer NOT NULL,
          \`time_started\` integer,
          \`time_completed\` integer,
          CONSTRAINT \`fk_routine_run_routine_id_routine_id_fk\` FOREIGN KEY (\`routine_id\`) REFERENCES \`routine\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`routine\` (
          \`id\` text PRIMARY KEY,
          \`directory\` text NOT NULL,
          \`project_id\` text NOT NULL,
          \`title\` text NOT NULL,
          \`enabled\` integer DEFAULT true NOT NULL,
          \`when\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`mode\` text NOT NULL,
          \`model\` text NOT NULL,
          \`worktree\` integer DEFAULT false NOT NULL,
          \`timeout_seconds\` integer,
          \`max_parallel\` integer,
          \`tags\` text NOT NULL,
          \`last_run_at\` integer,
          \`next_run_at\` integer,
          \`last_session_id\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`routine_run_routine_idx\` ON \`routine_run\` (\`routine_id\`,\`time_created\`);`)
      yield* tx.run(`CREATE INDEX \`routine_run_status_idx\` ON \`routine_run\` (\`status\`);`)
      yield* tx.run(`CREATE INDEX \`routine_directory_idx\` ON \`routine\` (\`directory\`);`)
      yield* tx.run(
        `CREATE INDEX \`routine_next_run_idx\` ON \`routine\` (\`next_run_at\`) WHERE "routine"."enabled" = 1 and "routine"."next_run_at" is not null;`,
      )
    })
  },
}

export default migration
