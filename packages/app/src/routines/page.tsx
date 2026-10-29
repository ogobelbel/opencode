import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { sessionHref } from "@/shell/routes/session"
import { RoutineEditor } from "./editor"
import { demoProjects, demoRoutines, demoRuns } from "./fixtures"
import { formatDateTime, formatTime, routineModelLabel, runStatusClass } from "./format"
import type { Routine, RoutineRun, RoutineRunStatus } from "./types"

type Store = {
  routines: Routine[]
  runs: RoutineRun[]
  editor: { open: boolean; routine?: Routine }
  expanded: Record<string, boolean>
}

const runStatusKeys = {
  queued: "routines.run.status.queued",
  running: "routines.run.status.running",
  completed: "routines.run.status.completed",
  failed: "routines.run.status.failed",
  cancelled: "routines.run.status.cancelled",
  skipped: "routines.run.status.skipped",
} as const satisfies Record<RoutineRunStatus, string>

const cloneRoutine = (routine: Routine): Routine => ({
  ...routine,
  when: { ...routine.when },
  model: { ...routine.model },
  tags: [...routine.tags],
  time: { ...routine.time },
})

const cloneRun = (run: RoutineRun): RoutineRun => ({
  ...run,
  diff: run.diff ? { ...run.diff } : undefined,
  time: { ...run.time },
})

export function RoutinesPage() {
  const language = useLanguage()
  const global = useGlobal()

  const [store, setStore] = createStore<Store>({
    routines: demoRoutines.map(cloneRoutine),
    runs: demoRuns.map(cloneRun),
    editor: { open: false },
    expanded: {},
  })

  const serverKey = () => {
    const conn = global.servers.list()[0]

    return conn ? ServerConnection.key(conn) : undefined
  }

  const runsFor = (routineID: string) =>
    store.runs
      .filter((run) => run.routineID === routineID)
      .toSorted((a, b) => Date.parse(b.time.created) - Date.parse(a.time.created))

  const editorKey = () => (store.editor.open ? (store.editor.routine?.id ?? "new") : undefined)

  const openNew = () => setStore("editor", { open: true, routine: undefined })

  const openEdit = (routine: Routine) => setStore("editor", { open: true, routine })

  const save = (routine: Routine) => {
    const index = store.routines.findIndex((item) => item.id === routine.id)

    if (index === -1) setStore("routines", (items) => [...items, routine])
    else setStore("routines", index, routine)

    setStore("editor", { open: false, routine: undefined })
  }

  const toggle = (routine: Routine, enabled: boolean) => {
    const index = store.routines.findIndex((item) => item.id === routine.id)

    if (index === -1) return
    setStore("routines", index, {
      ...routine,
      enabled,
      time: { ...routine.time, updated: new Date().toISOString() },
    })
  }

  // Stage 1 is UI only: "Run now" records a queued run locally instead of asking a scheduler to start one.
  const runNow = (routine: Routine) => {
    const index = store.routines.findIndex((item) => item.id === routine.id)

    if (index === -1) return
    const now = new Date().toISOString()

    setStore("routines", index, { ...routine, lastRunAt: now, time: { ...routine.time, updated: now } })
    setStore("runs", (runs) => [
      {
        id: `run_${crypto.randomUUID()}`,
        routineID: routine.id,
        status: "queued" as const,
        time: { created: now },
      },
      ...runs,
    ])
    setStore("expanded", routine.id, true)
  }

  const duplicate = (routine: Routine) => {
    const now = new Date().toISOString()

    setStore("routines", (items) => [
      ...items,
      {
        ...cloneRoutine(routine),
        id: `routine_${crypto.randomUUID()}`,
        title: language.t("routines.copySuffix", { title: routine.title }),
        enabled: false,
        lastRunAt: undefined,
        nextRunAt: undefined,
        lastSessionID: undefined,
        time: { created: now, updated: now },
      },
    ])
  }

  const remove = (routine: Routine) => {
    setStore("routines", (items) => items.filter((item) => item.id !== routine.id))
    setStore("runs", (runs) => runs.filter((run) => run.routineID !== routine.id))
  }

  return (
    <div
      data-slot="routines-panel"
      class="mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
    >
      <div class="flex shrink-0 items-center justify-between gap-4 border-b border-v2-border-border-muted px-5 py-4">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h1 class="text-[15px] font-medium leading-5 text-v2-text-text-base">{language.t("routines.title")}</h1>
          <p class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            {language.t("routines.description")}
          </p>
        </div>
        <Button variant="contrast" icon="plus" onClick={openNew}>
          {language.t("routines.action.new")}
        </Button>
      </div>

      <div data-scrollable class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div class="mx-auto flex w-full max-w-[880px] flex-col gap-3">
          <Show when={editorKey()} keyed>
            {(_key) => (
              <RoutineEditor
                routine={store.editor.routine}
                projects={demoProjects}
                defaultModel={demoRoutines[0].model}
                onSave={save}
                onCancel={() => setStore("editor", { open: false, routine: undefined })}
              />
            )}
          </Show>

          <Show
            when={store.routines.length > 0}
            fallback={
              <div class="flex flex-col items-center gap-2 py-16 text-center">
                <Icon name="outline-rotate-clockwise" class="text-v2-icon-icon-faint" />
                <p class="text-[13px] font-medium leading-[var(--line-height-compact)] text-v2-text-text-base">
                  {language.t("routines.empty.title")}
                </p>
                <p class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                  {language.t("routines.empty.description")}
                </p>
              </div>
            }
          >
            <For each={store.routines}>
              {(routine) => (
                <RoutineCard
                  routine={routine}
                  runs={runsFor(routine.id)}
                  expanded={!!store.expanded[routine.id]}
                  serverKey={serverKey()}
                  onToggle={(enabled) => toggle(routine, enabled)}
                  onRunNow={() => runNow(routine)}
                  onToggleHistory={() => setStore("expanded", routine.id, (value) => !value)}
                  onEdit={() => openEdit(routine)}
                  onDuplicate={() => duplicate(routine)}
                  onDelete={() => remove(routine)}
                />
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  )
}

function RoutineCard(props: {
  routine: Routine
  runs: RoutineRun[]
  expanded: boolean
  serverKey?: ServerConnection.Key
  onToggle(enabled: boolean): void
  onRunNow(): void
  onToggleHistory(): void
  onEdit(): void
  onDuplicate(): void
  onDelete(): void
}) {
  const language = useLanguage()

  const lastRun = () => formatDateTime(language.locale(), props.routine.lastRunAt)
  const nextRun = () => formatDateTime(language.locale(), props.routine.nextRunAt)

  return (
    <div
      data-slot="routine-card"
      class="flex flex-col gap-3 rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-4"
      classList={{ "opacity-60": !props.routine.enabled }}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-1">
          <h2 class="truncate text-[13px] font-medium leading-[var(--line-height-compact)] text-v2-text-text-base">
            {props.routine.title}
          </h2>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            <code class="font-mono text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-base">
              {props.routine.when.cron}
            </code>
            <span>{props.routine.when.tz}</span>
            <span aria-hidden="true">·</span>
            <span class="truncate">
              {props.routine.model.providerID
                ? routineModelLabel(props.routine.model)
                : language.t("routines.model.unknown")}
            </span>
          </div>
        </div>
        <Switch
          checked={props.routine.enabled}
          onChange={props.onToggle}
          hideLabel
          aria-label={language.t("routines.enabled")}
        >
          {props.routine.title}
        </Switch>
      </div>

      <Show when={props.routine.tags.length > 0}>
        <div class="flex flex-wrap items-center gap-1.5">
          <For each={props.routine.tags}>{(tag) => <Badge variant="subtle">{tag}</Badge>}</For>
        </div>
      </Show>

      <div class="grid gap-x-6 gap-y-1 text-[13px] leading-[var(--line-height-compact)] sm:grid-cols-2">
        <div class="flex min-w-0 gap-1.5">
          <span class="shrink-0 text-v2-text-text-muted">{language.t("routines.lastRun.label")}</span>
          <span class="truncate text-v2-text-text-base">
            {lastRun() ?? language.t("routines.never")}
          </span>
        </div>
        <div class="flex min-w-0 gap-1.5">
          <span class="shrink-0 text-v2-text-text-muted">{language.t("routines.nextRun.label")}</span>
          <span class="truncate text-v2-text-text-base">
            {nextRun() ?? language.t("routines.notScheduled")}
          </span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-1 border-t border-v2-border-border-muted pt-2">
        <Button variant="ghost" size="small" icon="outline-rotate-clockwise" onClick={props.onRunNow}>
          {language.t("routines.action.runNow")}
        </Button>
        <Button variant="ghost" size="small" icon="archive" onClick={props.onToggleHistory}>
          {props.expanded ? language.t("routines.action.hideHistory") : language.t("routines.action.history")}
        </Button>
        <Button variant="ghost" size="small" icon="edit" onClick={props.onEdit}>
          {language.t("routines.action.edit")}
        </Button>
        <Button variant="ghost" size="small" icon="copy" onClick={props.onDuplicate}>
          {language.t("routines.action.duplicate")}
        </Button>
        <Button variant="ghost-danger" size="small" icon="trash" onClick={props.onDelete}>
          {language.t("routines.action.delete")}
        </Button>
      </div>

      <Show when={props.expanded}>
        <div data-slot="routine-history" class="flex flex-col gap-2 border-t border-v2-border-border-muted pt-3">
          <div class="text-[13px] font-medium leading-[var(--line-height-compact)] text-v2-text-text-base">
            {language.t("routines.history.title")}
          </div>
          <Show
            when={props.runs.length > 0}
            fallback={
              <p class="py-2 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                {language.t("routines.history.empty")}
              </p>
            }
          >
            <For each={props.runs}>{(run) => <RunRow run={run} serverKey={props.serverKey} />}</For>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function RunRow(props: { run: RoutineRun; serverKey?: ServerConnection.Key }) {
  const language = useLanguage()
  const created = () => formatDateTime(language.locale(), props.run.time.created)
  const finished = () => formatTime(language.locale(), props.run.time.completed)

  return (
    <div
      data-slot="routine-run"
      class="grid gap-x-4 gap-y-1 rounded-[6px] px-2 py-2 text-[13px] leading-[var(--line-height-compact)] hover:bg-v2-overlay-simple-overlay-hover sm:grid-cols-[96px_minmax(0,1fr)_auto]"
    >
      <span class={`font-medium ${runStatusClass(props.run.status)}`}>{language.t(runStatusKeys[props.run.status])}</span>
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="truncate text-v2-text-text-base">{created()}</span>
        <Show when={props.run.error}>
          <span class="truncate text-v2-state-fg-danger">{props.run.error}</span>
        </Show>
        <Show when={props.run.branch}>
          {(branch) => <code class="truncate font-mono text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">{branch()}</code>}
        </Show>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-v2-text-text-muted sm:justify-end">
        <Show when={props.run.sessionID} fallback={<span>{language.t("routines.run.noSession")}</span>}>
          {(sessionID) => (
            <Show
              when={props.serverKey}
              fallback={
                <code class="font-mono text-[13px] leading-[var(--line-height-compact)]">{sessionID()}</code>
              }
            >
              {(serverKey) => (
                <a
                  href={sessionHref(serverKey(), sessionID())}
                  class="truncate text-v2-text-text-accent-hover hover:underline focus-visible:outline focus-visible:outline-2"
                >
                  {sessionID()}
                </a>
              )}
            </Show>
          )}
        </Show>
        <Show when={props.run.diff}>
          {(diff) => (
            <span class="flex items-center gap-1.5">
              <span class="text-v2-state-fg-success">+{diff().additions}</span>
              <span class="text-v2-state-fg-danger">−{diff().deletions}</span>
              <span>{language.plural("routines.run.diff.files", diff().files, { count: diff().files })}</span>
            </span>
          )}
        </Show>
        <Show when={finished()}>{(time) => <span>{time()}</span>}</Show>
      </div>
    </div>
  )
}
