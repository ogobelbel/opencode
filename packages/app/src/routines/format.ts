import type { RoutineModel, RoutineRunStatus } from "./types"

export function routineModelLabel(model: RoutineModel) {
  const base = `${model.providerID}/${model.modelID}`

  return model.variant ? `${base} · ${model.variant}` : base
}

export function formatDateTime(locale: string, value: string | undefined) {
  if (!value) return undefined

  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

export function formatTime(locale: string, value: string | undefined) {
  if (!value) return undefined

  return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(value))
}

export function runStatusClass(status: RoutineRunStatus) {
  switch (status) {
    case "completed":
      return "text-v2-state-fg-success"
    case "failed":
      return "text-v2-state-fg-danger"
    case "running":
    case "queued":
      return "text-v2-state-fg-warning"
    default:
      return "text-v2-text-text-muted"
  }
}
