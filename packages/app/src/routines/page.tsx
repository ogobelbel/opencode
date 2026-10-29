import type { ExperimentalRoutineCreateInput, RoutineInfo, RoutineModel, RoutineRun, RoutineRunStatus } from "@opencode/client/promise"
import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Switch } from "@opencode/ui/switch"
import { createEffect, For, on, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { formatServerError } from "@/runtime/server/errors"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import { sessionHref } from "@/shell/routes/session"
import { showToast } from "@/shell/notifications/toast"
import { RoutineEditor, type RoutineProject } from "./editor"
import { formatDateTime, formatTime, routineModelLabel, runStatusClass } from "./format"

const RUN_LIMIT = 20

const REFRESH_INTERVAL = 10_000

type RoutineEntry = {
  key: string
  server: ServerConnection.Any
  info: RoutineInfo
}

type RunState = "loading" | "ready" | "error"

type Store = {
  status: "loading" | "ready" | "error"
  error?: string
  routines: RoutineEntry[]
  runs: Record<string, RoutineRun[]>
  runsStatus: Record<string, RunState>
  expanded: Record<string, boolean>
  editor: { open: boolean; entry?: RoutineEntry; server?: ServerConnection.Any }
}

const runStatusKeys = {
  queued: "routines.run.status.queued",
  running: "routines.run.status.running",
  completed: "routines.run.status.completed",
  failed: "routines.run.status.failed",
  cancelled: "routines.run.status.cancelled",
  skipped: "routines.run.status.skipped",
} as const satisfies Record<RoutineRunStatus, string>

const emptyModel: RoutineModel = { providerID: "", modelID: "" }

export function RoutinesPage() {
  const language = useLanguage()
  const global = useGlobal()

  const [store, setStore] = createStore<Store>({
    status: "loading",
    routines: [],
    runs: {},
    runsStatus: {},
    expanded: {},
    editor: { open: false },
  })

  const connections = () =>
    global.servers.list().filter((conn) => {
      if (conn.type === "plugin" && conn.state !== "ready") return false

      return global.servers.health[ServerConnection.key(conn)]?.healthy !== false
    })

  const routineKey = (server: ServerConnection.Any, routineID: string) =>
    `${ServerConnection.key(server)}:${routineID}`

  const loadRuns = async (entry: RoutineEntry, quiet = false) => {
    if (!quiet) setStore("runsStatus", entry.key, "loading")

    try {
      const runs = await global.ensureServerCtx(entry.server).sdk.api.experimental.routine.runs({
        routineID: entry.info.id,
        limit: RUN_LIMIT,
      })

      setStore("runs", entry.key, runs)
      setStore("runsStatus", entry.key, "ready")
    } catch {
      // A failed poll keeps the runs already on screen, but a history with nothing to show reports the failure.
      if (!quiet || store.runsStatus[entry.key] === undefined) setStore("runsStatus", entry.key, "error")
    }
  }

  const loadRoutines = async (quiet: boolean) => {
    const list = connections()

    if (!quiet) setStore({ status: "loading", error: undefined })

    try {
      const settled = await Promise.allSettled(
        list.map(async (server) => {
          const routines = await global.ensureServerCtx(server).sdk.api.experimental.routine.list()

          return routines.map((info) => ({ key: routineKey(server, info.id), server, info }) satisfies RoutineEntry)
        }),
      )

      if (list.length > 0 && settled.every((result) => result.status === "rejected")) {
        throw settled.find((result) => result.status === "rejected")!.reason
      }

      const entries = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []))

      setStore({ status: "ready", error: undefined, routines: entries })

      return entries
    } catch (error) {
      if (!quiet) setStore({ status: "error", error: formatServerError(error, language.t) })

      return undefined
    }
  }

  const refreshAll = async (quiet = false) => {
    const entries = await loadRoutines(quiet)

    if (!entries) return
    await Promise.all(entries.filter((entry) => store.expanded[entry.key]).map((entry) => loadRuns(entry, quiet)))
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a failed request is opaque; the toast formats it
  const report = (error: unknown) =>
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(error, language.t),
    })

  const toggle = async (entry: RoutineEntry, enabled: boolean) => {
    try {
      await global.ensureServerCtx(entry.server).sdk.api.experimental.routine.update({
        routineID: entry.info.id,
        enabled,
      })
      await refreshAll(true)
    } catch (error) {
      report(error)
    }
  }

  const runNow = async (entry: RoutineEntry) => {
    try {
      await global.ensureServerCtx(entry.server).sdk.api.experimental.routine.run({ routineID: entry.info.id })
      setStore("expanded", entry.key, true)
      await refreshAll(true)
    } catch (error) {
      report(error)
    }
  }

  const duplicate = async (entry: RoutineEntry) => {
    try {
      await global.ensureServerCtx(entry.server).sdk.api.experimental.routine.duplicate({
        routineID: entry.info.id,
      })
      await refreshAll(true)
    } catch (error) {
      report(error)
    }
  }

  const remove = async (entry: RoutineEntry) => {
    try {
      await global.ensureServerCtx(entry.server).sdk.api.experimental.routine.delete({ routineID: entry.info.id })
      await refreshAll(true)
    } catch (error) {
      report(error)
    }
  }

  const editorServer = () => store.editor.entry?.server ?? store.editor.server

  const editorCtx = () => {
    const server = editorServer()

    return server ? global.ensureServerCtx(server) : undefined
  }

  const projectsFor = (ctx: ServerCtx, routine?: RoutineInfo): RoutineProject[] => {
    const used = ctx.projects.used()
    const ids = new Set(used.map((project) => project.id))

    const list = [...used, ...ctx.projects.unique().filter((project) => !ids.has(project.id))].map((project) => ({
      projectID: project.id,
      directory: project.worktree,
    }))

    // An existing routine may point at a sandbox the project list does not carry as its own worktree.
    if (routine && !list.some((project) => project.projectID === routine.projectID))
      list.unshift({ projectID: routine.projectID, directory: routine.directory })

    return list
  }

  const defaultModel = (): RoutineModel => {
    const entry = store.editor.entry

    if (entry) return entry.info.model
    const key = store.editor.server ? ServerConnection.key(store.editor.server) : undefined

    return store.routines.find((item) => ServerConnection.key(item.server) === key)?.info.model ?? emptyModel
  }

  const save = async (input: ExperimentalRoutineCreateInput) => {
    const entry = store.editor.entry
    const server = editorServer()

    try {
      if (entry) {
        await global.ensureServerCtx(entry.server).sdk.api.experimental.routine.update({
          routineID: entry.info.id,
          title: input.title,
          when: input.when,
          prompt: input.prompt,
          mode: input.mode,
          model: input.model,
          timeoutSeconds: input.timeoutSeconds,
          maxParallel: input.maxParallel,
          tags: input.tags,
        })
      } else {
        if (!server) return
        await global.ensureServerCtx(server).sdk.api.experimental.routine.create(input)
      }

      setStore("editor", { open: false, entry: undefined, server: undefined })
      await refreshAll(true)
    } catch (error) {
      report(error)
    }
  }

  const openNew = () => {
    const server = connections()[0]

    if (!server) return
    setStore("editor", { open: true, entry: undefined, server })
  }

  const openEdit = (entry: RoutineEntry) => setStore("editor", { open: true, entry, server: entry.server })

  const toggleHistory = (entry: RoutineEntry) => {
    const expanded = !store.expanded[entry.key]

    setStore("expanded", entry.key, expanded)

    if (expanded) void loadRuns(entry)
  }

  onMount(() => {
    void refreshAll()

    const timer = setInterval(() => void refreshAll(true), REFRESH_INTERVAL)

    onCleanup(() => clearInterval(timer))
  })

  createEffect(
    on(
      () => connections().map((conn) => ServerConnection.key(conn)).join("\n"),
      () => void refreshAll(true),
      { defer: true },
    ),
  )

  const editorKey = () => (store.editor.open ? (store.editor.entry?.key ?? "new") : undefined)

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
        <Button variant="contrast" icon="plus" onClick={openNew} disabled={connections().length === 0}>
          {language.t("routines.action.new")}
        </Button>
      </div>

      <div data-scrollable class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div class="mx-auto flex w-full max-w-[880px] flex-col gap-3">
          <Show when={editorKey()} keyed>
            {(_key) => (
              <Show when={editorServer()} keyed>
                {(server) => (
                  <Show when={editorCtx()}>
                    {(ctx) => (
                      <RoutineEditor
                        routine={store.editor.entry?.info}
                        server={server}
                        projects={projectsFor(ctx(), store.editor.entry?.info)}
                        defaultModel={defaultModel()}
                        onSave={(input) => void save(input)}
                        onCancel={() => setStore("editor", { open: false, entry: undefined, server: undefined })}
                      />
                    )}
                  </Show>
                )}
              </Show>
            )}
          </Show>

          <Show
            when={store.status !== "error"}
            fallback={
              <div class="flex flex-col items-center gap-2 py-16 text-center">
                <Icon name="outline-hexagonal-warning" class="text-v2-icon-icon-faint" />
                <p class="text-[13px] font-medium leading-[var(--line-height-compact)] text-v2-text-text-base">
                  {language.t("routines.error.title")}
                </p>
                <Show when={store.error}>
                  {(error) => (
                    <p class="max-w-[560px] text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                      {error()}
                    </p>
                  )}
                </Show>
                <Button variant="outline" onClick={() => void refreshAll()}>
                  {language.t("common.retry")}
                </Button>
              </div>
            }
          >
            <Show
              when={store.status !== "loading"}
              fallback={
                <div class="flex justify-center py-16">
                  <Loader class="text-v2-text-text-faint" />
                </div>
              }
            >
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
                  {(entry) => (
                    <RoutineCard
                      routine={entry.info}
                      runs={store.runs[entry.key] ?? []}
                      runsStatus={store.runsStatus[entry.key] ?? "loading"}
                      expanded={!!store.expanded[entry.key]}
                      serverKey={ServerConnection.key(entry.server)}
                      onToggle={(enabled) => void toggle(entry, enabled)}
                      onRunNow={() => void runNow(entry)}
                      onToggleHistory={() => toggleHistory(entry)}
                      onRetryRuns={() => void loadRuns(entry)}
                      onEdit={() => openEdit(entry)}
                      onDuplicate={() => void duplicate(entry)}
                      onDelete={() => void remove(entry)}
                    />
                  )}
                </For>
              </Show>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  )
}

function RoutineCard(props: {
  routine: RoutineInfo
  runs: RoutineRun[]
  runsStatus: RunState
  expanded: boolean
  serverKey: ServerConnection.Key
  onToggle(enabled: boolean): void
  onRunNow(): void
  onToggleHistory(): void
  onRetryRuns(): void
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
          <span class="truncate text-v2-text-text-base">{lastRun() ?? language.t("routines.never")}</span>
        </div>
        <div class="flex min-w-0 gap-1.5">
          <span class="shrink-0 text-v2-text-text-muted">{language.t("routines.nextRun.label")}</span>
          <span class="truncate text-v2-text-text-base">{nextRun() ?? language.t("routines.notScheduled")}</span>
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
            when={props.runsStatus !== "loading"}
            fallback={
              <div class="flex justify-center py-2">
                <Loader class="size-3.5 text-v2-text-text-faint" />
              </div>
            }
          >
            <Show
              when={props.runsStatus !== "error"}
              fallback={
                <div class="flex items-center justify-between gap-2 py-2">
                  <p class="text-[13px] leading-[var(--line-height-compact)] text-v2-state-fg-danger">
                    {language.t("routines.history.error")}
                  </p>
                  <Button variant="ghost" size="small" onClick={props.onRetryRuns}>
                    {language.t("common.retry")}
                  </Button>
                </div>
              }
            >
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
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function RunRow(props: { run: RoutineRun; serverKey: ServerConnection.Key }) {
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
          {(error) => <span class="truncate text-v2-state-fg-danger">{error()}</span>}
        </Show>
        <Show when={props.run.branch}>
          {(branch) => (
            <code class="truncate font-mono text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
              {branch()}
            </code>
          )}
        </Show>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-v2-text-text-muted sm:justify-end">
        <Show when={props.run.sessionID} fallback={<span>{language.t("routines.run.noSession")}</span>}>
          {(sessionID) => (
            <a
              href={sessionHref(props.serverKey, sessionID())}
              class="truncate text-v2-text-text-accent-hover hover:underline focus-visible:outline focus-visible:outline-2"
            >
              {sessionID()}
            </a>
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
