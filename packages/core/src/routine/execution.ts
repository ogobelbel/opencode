import { Model } from "@opencode/schema/model"
import { Permission } from "@opencode/schema/permission"
import { Provider } from "@opencode/schema/provider"
import { Routine } from "@opencode/schema/routine"
import type { FileDiff } from "@opencode/schema/file-diff"
import type { SessionMessage } from "../session/message.js"

/** Routine stores the SDK's `modelID`; Model.Ref names the same value `id`. */
export const modelRef = (model: Routine.Model) =>
  Model.Ref.make({
    providerID: Provider.ID.make(model.providerID),
    id: Model.ID.make(model.modelID),
    ...(model.variant === undefined ? {} : { variant: Model.VariantID.make(model.variant) }),
  })

export const permissions = (mode: Routine.Mode): Permission.Ruleset =>
  mode === "yolo"
    ? [
        { action: "*", resource: "*", effect: "allow" },
        { action: "question", resource: "*", effect: "deny" },
      ]
    : [
        { action: "*", resource: "*", effect: "deny" },
        ...["read", "grep", "glob", "list"].map((action) => ({ action, resource: "*", effect: "allow" as const })),
      ]

const SUMMARY_MAX_CHARS = 4_000

/** Expects newest-first messages, the order used when reading the tail of a Session. */
export const summary = (messages: readonly SessionMessage.Info[]): string | undefined => {
  const assistant = messages.find((message) => message.type === "assistant")
  if (assistant?.type !== "assistant") return
  const text = assistant.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .filter((text) => text.length > 0)
    .join("\n\n")
  if (text.length === 0) return
  if (text.length <= SUMMARY_MAX_CHARS) return text
  return `${text.slice(0, SUMMARY_MAX_CHARS)}\n[truncated]`
}

export const diffStats = (files: readonly FileDiff.Info[]): Routine.Diff => ({
  additions: files.reduce((total, file) => total + file.additions, 0),
  deletions: files.reduce((total, file) => total + file.deletions, 0),
  files: files.length,
})
