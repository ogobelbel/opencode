import { createMemo, createSignal, Show } from "solid-js"
import { Option, Schema } from "effect"
import type { FormInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { useI18n } from "@opencode/ui/context/i18n"
import { useModelPicker, type ModelPickerRef } from "@opencode/ui/context/model-picker"
import { useData } from "../context"

const CardMeta = Schema.Struct({
  description: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
})

/** "provider/model#variant" as the subagent tool reads it. */
const refString = (ref: ModelPickerRef) =>
  `${ref.providerID}/${ref.modelID}${ref.variant ? `#${ref.variant}` : ""}`

function parseModelRef(value: string | undefined) {
  if (!value) return

  const [target, variant] = value.split("#")
  const at = target.indexOf("/")

  if (at <= 0) return

  return { providerID: target.slice(0, at), modelID: target.slice(at + 1), variant }
}

/**
 * The start card for a subagent the user asked for: the task, its model, and whether to run it here or in a child
 * session. Rendered in place of the tool row while the subagent tool waits on its form.
 */
export function SubagentStartCard(props: { form: FormInfo }) {
  const data = useData()
  const i18n = useI18n()
  const picker = useModelPicker()

  const meta = createMemo(() => {
    const decoded = Schema.decodeUnknownOption(CardMeta)(props.form.metadata ?? {})

    return Option.isSome(decoded) ? decoded.value : undefined
  })

  const description = () => meta()?.description ?? props.form.title

  const [picked, setPicked] = createSignal(parseModelRef(meta()?.model))
  const [busy, setBusy] = createSignal(false)

  const label = () => {
    const ref = picked()

    return ref ? `${ref.providerID}/${ref.modelID}` : i18n.t("ui.subagentCard.model")
  }

  const settle = (action: "start" | "here" | "dismiss") => {
    const form = data.form
    const sessionID = data.sessionID

    if (!form || !sessionID || busy()) return
    setBusy(true)

    if (action === "dismiss") {
      void form.cancel({ sessionID, formID: props.form.id }).catch(() => setBusy(false))

      return
    }

    const chosen = picked()
    // An empty model keeps the model the tool would have used; "here" ignores it.
    const answer = { action, model: action === "start" && chosen ? refString(chosen) : "" }

    void form.reply({ sessionID, formID: props.form.id, answer }).catch(() => setBusy(false))
  }

  const choose = () => picker({ current: picked(), onPick: setPicked })

  return (
    <div
      data-component="subagent-start-card"
      class="my-1 flex w-full flex-col overflow-hidden rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-layer-01"
    >
      <div class="border-b border-v2-border-border-muted px-3 py-1.5 text-[12px] leading-4 text-v2-text-text-faint">
        {i18n.t("ui.subagentCard.title")}
      </div>
      <div class="flex flex-col gap-1 px-3 pt-2.5">
        <div class="flex items-start gap-2">
          <span class="min-w-0 flex-1 text-[13px] font-medium leading-5 text-v2-text-text-base">
            {description()}
          </span>
          <IconButton
            icon={<Icon name="outline-xmark" size="small" />}
            size="normal"
            variant="ghost-muted"
            aria-label={i18n.t("ui.subagentCard.dismiss")}
            disabled={busy()}
            onClick={() => settle("dismiss")}
          />
        </div>
        <Show when={meta()?.prompt}>
          {(prompt) => (
            <p class="max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-5 text-v2-text-text-muted">
              {prompt()}
            </p>
          )}
        </Show>
      </div>
      <div class="flex items-center gap-1.5 px-3 py-2.5">
        <button
          type="button"
          class="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[12px] leading-4 text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
          disabled={busy()}
          onClick={choose}
        >
          {i18n.t("ui.subagentCard.options")}
        </button>
        <span class="min-w-0 flex-1 truncate text-[12px] leading-4 text-v2-text-text-faint">{label()}</span>
        <button
          type="button"
          class="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[12px] leading-4 text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
          disabled={busy()}
          onClick={() => settle("here")}
        >
          {i18n.t("ui.subagentCard.here")}
        </button>
        <Button size="small" variant="contrast" disabled={busy()} onClick={() => settle("start")}>
          {i18n.t("ui.subagentCard.start")}
        </Button>
      </div>
    </div>
  )
}
