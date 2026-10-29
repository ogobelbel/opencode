import { createSimpleContext } from "./helper"

export type ModelPickerRef = { providerID: string; modelID: string; variant?: string }

/**
 * Opens the app's model list and reports the pick without changing the composer's selection.
 * `current` marks the row to highlight.
 */
export type ModelPicker = (input: { current?: ModelPickerRef; onPick: (ref: ModelPickerRef) => void }) => void

const ctx = createSimpleContext<ModelPicker, { open: ModelPicker }>({
  name: "ModelPicker",
  gate: false,
  init: (props) => props.open,
})

export const ModelPickerProvider = ctx.provider

export const useModelPicker = ctx.use
