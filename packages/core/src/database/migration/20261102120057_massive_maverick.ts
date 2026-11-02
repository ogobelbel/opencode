import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261102120057_massive_maverick",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`routine\` ADD \`permissions\` text;`)
    })
  },
}

export default migration
