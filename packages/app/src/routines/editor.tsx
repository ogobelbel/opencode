import { Button } from "@opencode/ui/button"
import { Select } from "@opencode/ui/select"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import type { RoutineProject } from "./fixtures"
import { RoutineModelPicker } from "./model-picker"
import type { Routine, RoutineMode, RoutineModel } from "./types"

type EditorState = {
  title: string
  prompt: string
  projectID: string
  directory: string
  cron: string
  tz: string
  model: RoutineModel
  variant: string
  mode: RoutineMode
  timeoutSeconds: string
  maxParallel: string
  tags: string
}

const modes: RoutineMode[] = ["yolo", "read_only"]

const variants = ["", "low", "medium", "high"]

const optionalNumber = (value: string) => {
  const parsed = Number(value)

  return value.trim() && Number.isFinite(parsed) ? parsed : undefined
}

export function RoutineEditor(props: {
  routine?: Routine
  projects: RoutineProject[]
  defaultModel: RoutineModel
  onSave(routine: Routine): void
  onCancel(): void
}) {
  const language = useLanguage()

  const project = () =>
    props.projects.find((item) => item.projectID === props.routine?.projectID) ?? props.projects[0]

  const [form, setForm] = createStore<EditorState>({
    title: props.routine?.title ?? "",
    prompt: props.routine?.prompt ?? "",
    projectID: project()?.projectID ?? "",
    directory: props.routine?.directory ?? project()?.directory ?? "",
    cron: props.routine?.when.cron ?? "0 9 * * 1-5",
    tz: props.routine?.when.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    model: props.routine?.model ?? props.defaultModel,
    variant: props.routine?.model.variant ?? "",
    mode: props.routine?.mode ?? "read_only",
    timeoutSeconds: props.routine?.timeoutSeconds?.toString() ?? "",
    maxParallel: props.routine?.maxParallel?.toString() ?? "",
    tags: props.routine?.tags.join(", ") ?? "",
  })

  const save = (event: SubmitEvent) => {
    event.preventDefault()
    const title = form.title.trim()

    if (!title) return
    const now = new Date().toISOString()

    props.onSave({
      id: props.routine?.id ?? `routine_${crypto.randomUUID()}`,
      directory: form.directory,
      projectID: form.projectID,
      title,
      enabled: props.routine?.enabled ?? true,
      when: { cron: form.cron.trim(), tz: form.tz.trim() },
      prompt: form.prompt,
      mode: form.mode,
      model: { ...form.model, variant: form.variant || undefined },
      timeoutSeconds: optionalNumber(form.timeoutSeconds),
      maxParallel: optionalNumber(form.maxParallel),
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      lastRunAt: props.routine?.lastRunAt,
      nextRunAt: props.routine?.nextRunAt,
      lastSessionID: props.routine?.lastSessionID,
      time: { created: props.routine?.time.created ?? now, updated: now },
    })
  }

  return (
    <form
      data-slot="routine-editor"
      class="rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-4"
      onSubmit={save}
    >
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="text-[15px] font-medium leading-5 text-v2-text-text-base">
          {props.routine ? language.t("routines.editor.edit") : language.t("routines.editor.create")}
        </h2>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1.5 md:col-span-2">
          <span class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            {language.t("routines.editor.name")}
          </span>
          <TextInput
            class="!w-full"
            value={form.title}
            placeholder={language.t("routines.editor.name.placeholder")}
            onInput={(event) => setForm("title", event.currentTarget.value)}
          />
        </label>

        <label class="flex flex-col gap-1.5 md:col-span-2">
          <span class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            {language.t("routines.editor.prompt")}
          </span>
          <Textarea
            class="!w-full"
            rows={5}
            value={form.prompt}
            placeholder={language.t("routines.editor.prompt.placeholder")}
            onInput={(event) => setForm("prompt", event.currentTarget.value)}
          />
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            {language.t("routines.editor.directory")}
          </span>
          <Select
            class="!w-full"
            options={props.projects}
            current={props.projects.find((item) => item.projectID === form.projectID)}
            value={(item) => item.projectID}
            label={(item) => item.directory}
            onSelect={(item) => {
              if (!item) return
              setForm({ projectID: item.projectID, directory: item.directory })
            }}
            aria-label={language.t("routines.editor.directory")}
          />
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            {language.t("routines.editor.mode")}
          </span>
          <Select
            class="!w-full"
            options={modes}
            current={form.mode}
            value={(mode) => mode}
            label={(mode) =>
              mode === "yolo" ? language.t("routines.editor.mode.yolo") : language.t("routines.editor.mode.readOnly")
            }
            onSelect={(mode) => mode && setForm("mode", mode)}
            aria-label={language.t("routines.editor.mode")}
          />
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            {language.t("routines.editor.cron")}
          </span>
          <TextInput
            class="!w-full"
            value={form.cron}
            placeholder={language.t("routines.editor.cron.placeholder")}
            onInput={(event) => setForm("cron", event.currentTarget.value)}
          />
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            {language.t("routines.editor.tz")}
          </span>
          <TextInput
            class="!w-full"
            value={form.tz}
            placeholder="UTC"
            onInput={(event) => setForm("tz", event.currentTarget.value)}
          />
        </label>

        <div class="flex flex-col gap-1.5">
          <span class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            {language.t("routines.editor.model")}
          </span>
          <RoutineModelPicker
            directory={form.directory}
            model={form.model}
            onChange={(model) => setForm("model", model)}
          />
        </div>

        <label class="flex flex-col gap-1.5">
          <span class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            {language.t("routines.editor.variant")}
          </span>
          <Select
            class="!w-full"
            options={variants}
            current={form.variant}
            value={(variant) => variant}
            label={(variant) => variant || language.t("routines.editor.variant.default")}
            onSelect={(variant) => setForm("variant", variant ?? "")}
            aria-label={language.t("routines.editor.variant")}
          />
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            {language.t("routines.editor.timeout")}
          </span>
          <TextInput
            class="!w-full"
            type="number"
            min={0}
            numeric
            value={form.timeoutSeconds}
            onInput={(event) => setForm("timeoutSeconds", event.currentTarget.value)}
          />
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            {language.t("routines.editor.maxParallel")}
          </span>
          <TextInput
            class="!w-full"
            type="number"
            min={1}
            numeric
            value={form.maxParallel}
            onInput={(event) => setForm("maxParallel", event.currentTarget.value)}
          />
        </label>

        <label class="flex flex-col gap-1.5 md:col-span-2">
          <span class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            {language.t("routines.editor.tags")}
          </span>
          <TextInput
            class="!w-full"
            value={form.tags}
            placeholder={language.t("routines.editor.tags.placeholder")}
            onInput={(event) => setForm("tags", event.currentTarget.value)}
          />
        </label>
      </div>

      <div class="mt-4 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          {language.t("routines.editor.cancel")}
        </Button>
        <Button type="submit" variant="contrast" disabled={!form.title.trim()}>
          {language.t("routines.editor.save")}
        </Button>
      </div>
    </form>
  )
}
