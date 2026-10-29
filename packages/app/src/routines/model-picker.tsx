import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Show } from "solid-js"
import { DialogSelectModel } from "@/providers/models/select-dialog"
import { LocalProvider, useLocal, type ModelSelection } from "@/providers/models/selection"
import { ModelsProvider } from "@/providers/models/models"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerProvider } from "@/runtime/server/current"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { LocationProvider } from "@/workspaces/location"
import { routineModelLabel } from "./format"
import type { RoutineModel } from "./types"

export function RoutineModelPicker(props: {
  directory: string
  model: RoutineModel
  onChange(model: RoutineModel): void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const global = useGlobal()

  const connection = () => {
    const servers = global.servers.list()
    const healthy = servers.find((server) => global.servers.health[ServerConnection.key(server)]?.healthy)

    return healthy ?? servers[0]
  }

  const open = () => {
    const conn = connection()

    // The model picker reads the server's model catalog, so without a server there is nothing to choose from.
    if (!conn) return

    void dialog.show(() => (
      <ServerProvider conn={conn}>
        <ModelsProvider directory={props.directory}>
          <LocationProvider directory={props.directory}>
            <LocalProvider>
              <RoutineModelDialog model={props.model} onChange={props.onChange} />
            </LocalProvider>
          </LocationProvider>
        </ModelsProvider>
      </ServerProvider>
    ))
  }

  return (
    <Button
      type="button"
      variant="outline"
      class="!w-full !justify-start"
      icon="models"
      onClick={open}
      aria-label={language.t("routines.editor.model.choose")}
    >
      <span class="min-w-0 truncate text-start">
        <Show
          when={props.model.providerID}
          fallback={language.t("routines.editor.model.choose")}
        >
          {routineModelLabel(props.model)}
        </Show>
      </span>
    </Button>
  )
}

// DialogSelectModel reads and writes a ModelSelection. This adapter keeps the dialog's catalog, recent and favorite
// lists, but points the current value at the routine being edited instead of a chat draft.
function RoutineModelDialog(props: { model: RoutineModel; onChange(model: RoutineModel): void }) {
  const local = useLocal().model

  const model: ModelSelection = {
    ...local,
    current: () =>
      local.list().find(
        (item) => item.provider.id === props.model.providerID && item.id === props.model.modelID,
      ),
    set(item, options) {
      local.set(item, options)

      if (!item) return
      props.onChange({ providerID: item.providerID, modelID: item.modelID })
    },
    variant: {
      ...local.variant,
      current(item) {
        if (!item || (item.providerID === props.model.providerID && item.modelID === props.model.modelID))
          return props.model.variant

        return local.variant.current(item)
      },
      set(value) {
        local.variant.set(value)
        props.onChange({ ...props.model, variant: value })
      },
    },
  }

  return <DialogSelectModel model={model} />
}
