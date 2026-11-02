import { expect, test } from "bun:test"
import { isRoutineSession } from "./inbox-routines"

test("detects a routine by metadata", () => {
  expect(isRoutineSession({ title: "Anything", metadata: { routine: { id: "aut_1" } } })).toBe(true)
})

test("falls back to the title prefix for older routine sessions", () => {
  expect(isRoutineSession({ title: "Routine: trello-clarify-todo" })).toBe(true)
  expect(isRoutineSession({ title: "Routine: trello-clarify-todo", metadata: undefined })).toBe(true)
})

test("leaves normal sessions out", () => {
  expect(isRoutineSession({ title: "Fix the sidebar" })).toBe(false)
  expect(isRoutineSession({ title: "Fix the sidebar", metadata: {} })).toBe(false)
  expect(isRoutineSession({ title: undefined })).toBe(false)
})
