import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import {
  createContext,
  createEffect,
  createMemo,
  createUniqueId,
  For,
  on,
  Show,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { useDialog, useDialogLayer } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { Loader } from "@opencode/ui/loader"
import { displayName } from "@opencode/ui/project-avatar"
import { useServers } from "@/runtime/server/registry"
import { useLanguage } from "@/runtime/i18n/language"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import type { LocalProject } from "@/shell/state/layout"
import { sessionTabTitle } from "./tab-title"
import { sessionTitle } from "@/session/title"
import { createSessionInbox, inboxArchived, type InboxEntry, type InboxStatus } from "./inbox-model"
import { isRoutineSession } from "./inbox-routines"
import { Disclosure } from "./disclosure"
import { compareWorking } from "./inbox-working"

const RECENT_LIMIT = 10

const InboxState = Persistence.struct({
  workingExpanded: Schema.Boolean,
  recentExpanded: Schema.Boolean,
})

const InboxNavigation = createContext<Accessor<string | undefined>>()

/** The experimental Inbox interface mode: the session inbox in place of vertical tabs. */
export function SidebarInbox() {
  const language = useLanguage()
  const dialog = useDialog()
  const servers = useServers()
  const inbox = createSessionInbox({ archived: true })

  const [state, setState, , ready] = persisted(Persist.global("sidebar.inbox"), InboxState, {
    workingExpanded: true,
    recentExpanded: false,
  })

  // Which rows show their subagent sessions. Kept in memory: the tree follows the work, not the layout.
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  // Routine chats are collapsed by default so they stop crowding normal sessions.
  const [ui, setUi] = createStore({ routinesExpanded: false })

  const [announcement, setAnnouncement] = createStore({ text: "" })

  createEffect((previous: Map<string, InboxStatus> | undefined) => {
    if (inbox.loading()) return

    const entries = inbox.entries()

    if (previous) {
      const text = entries
        .flatMap((entry) => {
          if (!previous.has(entry.key) || previous.get(entry.key) === entry.status || entry.status === "ready")
            return []

          return [
            language.t(`sidebar.inbox.announce.${entry.status}`, {
              title: sessionTabTitle(entry.session.title, language.t("session.tab.session")),
            }),
          ]
        })
        .join("\n")

      if (text) setAnnouncement("text", text)
    }

    return new Map(entries.map((entry) => [entry.key, entry.status]))
  })

  const sections = createMemo(() => {
    // Child sessions only ever render nested under their root, never in a section of their own.
    const list = inbox.entries().filter((entry) => !entry.session.parentID)
    const routines = list.filter((entry) => isRoutineSession(entry.session))
    const normal = list.filter((entry) => !isRoutineSession(entry.session))

    // Archived sessions are available through the Archived search dialog, not in the sidebar list.
    const active = normal.filter((entry) => !inboxArchived(entry))

    const needs = active
      .filter((entry) => entry.status === "approval" || entry.status === "input")
      .toSorted((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity))

    const unread = active
      .filter((entry) => entry.status === "done" || entry.status === "failed")
      .toSorted((a, b) => (b.since ?? 0) - (a.since ?? 0))

    const read = active.filter((entry) => entry.status === "ready").toSorted((a, b) => (b.since ?? 0) - (a.since ?? 0))

    const recent = state.recentExpanded ? read : read.slice(0, RECENT_LIMIT)

    // `time.updated` moves with every message of a run, so keep Working ordered by run start.
    const working = active.filter((entry) => entry.status === "working").toSorted(compareWorking)

    const current = list.find((entry) => inbox.selected(entry))

    return {
      needs,
      unread,
      recent,
      more: read.length > RECENT_LIMIT,
      current:
        current && ![...needs, ...unread, ...recent, ...working].some((entry) => entry.key === current.key)
          ? [current]
          : [],
      archived: list.some(inboxArchived),
      working,
      routines,
      routinesAttention: routines.some((entry) => entry.status === "approval" || entry.status === "input"),
    }
  })

  const routinesOpen = () => ui.routinesExpanded

  // Open the group once when a routine starts waiting on a person; after that the toggle is authoritative.
  let routineAttention = 0
  createEffect(() => {
    const count = sections().routines.filter(
      (entry) => entry.status === "approval" || entry.status === "input",
    ).length

    if (count > routineAttention) setUi("routinesExpanded", true)

    routineAttention = count
  })

  // A routine run is bound to one project, so group its chats under that project's name.
  const routineGroups = createMemo(() => {
    const groups = new Map<string, { label: string; entries: InboxEntry[] }>()

    for (const entry of sections().routines) {
      const project = entry.ctx.projects.forSession(entry.session)
      const key = project?.worktree ?? entry.session.location.directory
      const group = groups.get(key)

      if (group) {
        group.entries.push(entry)
        continue
      }

      groups.set(key, {
        label: displayName(project ?? { worktree: entry.session.location.directory }),
        entries: [entry],
      })
    }

    return [...groups.entries()]
      .toSorted((a, b) => a[1].label.localeCompare(b[1].label))
      .map(([key, group]) => ({ key, ...group }))
  })

  const selectedWorking = createMemo(() => sections().working.find((entry) => inbox.selected(entry))?.key)

  // Expand when a working session becomes current, not on each update or manual collapse.
  createEffect(() => {
    if (!ready() || !selectedWorking()) return
    setState("workingExpanded", true)
  })

  // The client only refreshes `time.idle` for loaded sessions when a run ends, so load every working one.
  createEffect(() => {
    sections().working.forEach((entry) => {
      if (entry.ctx.data.session.get(entry.session.id)) return
      void entry.ctx.data.session.sync(entry.session.id).catch(() => undefined)
    })
  })

  // Git info is not stored on the session, so eagerly load it for every shown row.
  createEffect(() => {
    const visible = sections()

    inbox.loadBranches([
      ...visible.needs,
      ...visible.current,
      ...visible.working,
      ...visible.unread,
      ...visible.recent,
      ...visible.routines,
    ])
  })

  // Takes an accessor so only the For tracks the section. Reading it here would recreate the For, remounting every
  // row on any session change and resetting the list's scroll.
  const rows = (list: () => InboxEntry[], depth = 0) => (
    <For each={list().map((entry) => entry.key)}>
      {(key) => (
        <Show when={inbox.byKey().get(key)}>
          {(entry) => (
            <>
              <InboxSessionCard
                project={entry().ctx.projects.forSession(entry().session)}
                directory={entry().session.location.directory}
                title={entry().session.title}
                status={entry().status}
                server={servers.tag(entry().conn)}
                since={entry().since}
                depth={depth}
                childCount={inbox.children(entry()).length}
                expanded={!!expanded[entry().key]}
                onToggle={() => setExpanded(entry().key, !expanded[entry().key])}
                routine={isRoutineSession(entry().session)}
                selected={inbox.selected(entry())}
                now={inbox.now(entry().status)}
                branch={inbox.branch(entry())}
                worktree={inbox.inWorktree(entry())}
                archived={inboxArchived(entry())}
                onOpen={() => inbox.open(entry())}
                onArchive={() => void inbox.archive(entry())}
                onUnarchive={() => void inbox.unarchive(entry())}
                onDelete={() => {
                  const current = entry()

                  void dialog.show(() => (
                    <DeleteDialog title={current.session.title} onConfirm={() => void inbox.remove(current)} />
                  ))
                }}
              />
              <Show when={expanded[entry().key]}>
                {/* A guide line runs down the children, one step further in per level. */}
                <div class="relative" style={{ "margin-inline-start": "14px" }}>
                  <span
                    aria-hidden="true"
                    class="pointer-events-none absolute inset-y-0 start-0 w-px bg-v2-border-border-muted"
                  />
                  {rows(() => inbox.children(entry()), depth + 1)}
                </div>
              </Show>
            </>
          )}
        </Show>
      )}
    </For>
  )

  // Render slots inside InboxNavigation without recreating section objects on updates.
  const groups = [
    {
      id: "routines",
      get label() {
        return language.t("sidebar.inbox.section.routines")
      },
      get count() {
        return sections().routines.length
      },
      get attention() {
        return sections().routinesAttention
      },
      get expanded() {
        return routinesOpen()
      },
      onToggle: () => setUi("routinesExpanded", !ui.routinesExpanded),
      rows: () => (
        <Show when={routinesOpen()}>
          <For each={routineGroups()}>
            {(group) => (
              <div class="flex flex-col gap-0.5">
                <div class="flex h-5 items-center px-1.5 text-[11px] leading-4 font-medium text-v2-text-text-faint">
                  <span class="min-w-0 truncate">{group.label}</span>
                </div>
                {rows(() => group.entries)}
              </div>
            )}
          </For>
        </Show>
      ),
    },
    {
      id: "needs",
      get label() {
        return language.t("sidebar.inbox.section.needsAttention")
      },
      get count() {
        return sections().needs.length
      },
      rows: () => rows(() => sections().needs),
    },
    {
      id: "unread",
      get label() {
        return language.t("sidebar.inbox.section.unread")
      },
      get count() {
        return sections().unread.length
      },
      rows: () => rows(() => sections().unread),
    },
    {
      id: "recent",
      get label() {
        return language.t("sidebar.inbox.section.recent")
      },
      get count() {
        return sections().recent.length
      },
      rows: () => rows(() => sections().recent),
      more: () => (
        <Show when={sections().more}>
          <Button
            variant="ghost-muted"
            size="normal"
            class="w-full justify-start px-2"
            aria-expanded={state.recentExpanded}
            onClick={() => setState("recentExpanded", !state.recentExpanded)}
          >
            {language.t(state.recentExpanded ? "sidebar.inbox.showLess" : "sidebar.inbox.showMore")}
          </Button>
        </Show>
      ),
    },
  ]

  return (
    <InboxSessionList
      loading={inbox.loading()}
      announcement={announcement.text}
      current={{
        get count() {
          return sections().current.length
        },
        rows: () => rows(() => sections().current),
      }}
      sections={groups}
      working={{
        get count() {
          return sections().working.length
        },
        rows: () => rows(() => sections().working),
        get expanded() {
          return state.workingExpanded
        },
        onToggle: () => setState("workingExpanded", !state.workingExpanded),
      }}
      archived={sections().archived}
      onArchived={async () => {
        const { DialogSessionSearch } = await import("@/shell/commands/session-search")

        void dialog.show(() => <DialogSessionSearch archived />)
      }}
    />
  )
}

// The session leaves the list at once, so the dialog closes before the delete request instead of after it.
function DeleteDialog(props: { title: string | undefined; onConfirm: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const layer = useDialogLayer()

  const close = () => dialog.close(layer?.id)

  const confirm = () => {
    if (dialog.closing) return
    close()
    props.onConfirm()
  }

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("session.delete.title")}
          description={language.t("session.delete.confirm", {
            name: sessionTitle(props.title) ?? language.t("command.session.new"),
          })}
        />
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" autofocus disabled={dialog.closing} onClick={close}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="danger" disabled={dialog.closing} onClick={confirm}>
          {language.t("session.delete.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function InboxSessionList(props: {
  loading?: boolean
  announcement?: string
  current: { count: number; rows: () => JSX.Element }
  sections: {
    id: string
    label: string
    count: number
    rows: () => JSX.Element
    more?: () => JSX.Element
    attention?: boolean
    expanded?: boolean
    onToggle?: () => void
  }[]
  working: { count: number; rows: () => JSX.Element; expanded: boolean; onToggle: () => void }
  archived: boolean
  onArchived: () => void
}) {
  const language = useLanguage()
  const id = createUniqueId()

  const [navigation, setNavigation] = createStore<{ focused?: string }>({})

  let container: HTMLDivElement | undefined

  createEffect(
    on(
      () => [
        props.loading,
        props.current.count,
        ...props.sections.map((section) => section.count),
        props.working.count,
        props.working.expanded,
      ],
      () => {
        if (props.loading) return

        const rows = Array.from(
          container?.querySelectorAll<HTMLButtonElement>('[data-slot="sidebar-inbox-item"]') ?? [],
        )

        const target =
          rows.find((row) => row.id === navigation.focused) ??
          rows.find((row) => row.dataset.state === "active") ??
          rows[0]

        setNavigation("focused", target?.id)
      },
    ),
  )

  return (
    <InboxNavigation.Provider value={() => navigation.focused}>
      <div
        ref={container}
        data-slot="sidebar-inbox"
        aria-busy={props.loading}
        class="flex min-h-0 flex-1 flex-col"
        onFocusIn={(event) => {
          const row = event.target.closest<HTMLButtonElement>('[data-slot="sidebar-inbox-item"]')

          if (row) setNavigation("focused", row.id)
        }}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

          const rows = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-slot="sidebar-inbox-item"]'),
          )

          const index = rows.findIndex((row) => row === event.target)

          if (index === -1) return

          let next = index

          switch (event.key) {
            case "Home":
              next = 0
              break
            case "End":
              next = rows.length - 1
              break
            case "ArrowUp":
              next = Math.max(0, index - 1)
              break
            case "ArrowDown":
              next = Math.min(rows.length - 1, index + 1)
              break
            default:
              return
          }

          event.preventDefault()

          rows[next].focus({ preventScroll: true })
          rows[next].scrollIntoView({ block: "nearest" })
        }}
      >
        <span class="sr-only" role="status" aria-atomic="true">
          {props.announcement}
        </span>
        <Show
          when={!props.loading}
          fallback={
            <div class="flex justify-center p-2">
              <Loader role="img" aria-hidden="false" aria-label={language.t("common.loading")} />
            </div>
          }
        >
          <div
            data-slot="sidebar-inbox-scroll"
            data-scrollable
            class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-1"
          >
            <Show when={props.current.count > 0}>
              <div class="flex shrink-0 flex-col gap-0.5 pb-2.5">{props.current.rows()}</div>
            </Show>
            <For each={props.sections}>
              {(section) => (
                <Show when={section.count > 0}>
                  <div role="group" aria-labelledby={`${id}-${section.id}`} class="flex shrink-0 flex-col gap-2 pb-2.5">
                    <SectionHeader
                      id={`${id}-${section.id}`}
                      label={section.label}
                      expanded={section.expanded}
                      attention={section.attention}
                      onToggle={section.onToggle}
                    />
                    <div class="flex flex-col gap-0.5">{section.rows()}</div>
                    {section.more?.()}
                  </div>
                </Show>
              )}
            </For>
            <Show
              when={
                props.current.count === 0 &&
                props.working.count === 0 &&
                props.sections.every((section) => section.count === 0)
              }
            >
              <div class="px-1.5 py-2 text-[13px] leading-4 text-v2-text-text-faint">
                {language.t("sidebar.inbox.empty")}
              </div>
            </Show>
            <Show when={props.archived}>
              <div class="shrink-0 pt-3">
                <Button
                  variant="ghost-muted"
                  size="normal"
                  class="w-full justify-start px-2"
                  onClick={props.onArchived}
                >
                  {language.t("sidebar.inbox.section.archived")}
                </Button>
              </div>
            </Show>
          </div>
          {/* Working sessions sit in a shelf pinned below the scrolling list. */}
          <Show when={props.working.count > 0}>
            <div
              data-slot="sidebar-inbox-working"
              role="group"
              aria-labelledby={`${id}-working`}
              class="relative flex max-h-[40%] shrink-0 flex-col gap-2 pt-[7px]"
            >
              <span
                aria-hidden="true"
                class="pointer-events-none absolute top-0 h-px bg-v2-border-border-muted"
                style={{
                  "inset-inline-start": "calc(1px - var(--sidebar-inset-start, 11px))",
                  "inset-inline-end": "calc(1px - (var(--sidebar-inset-end, 3px) + var(--sidebar-divider-bleed, 0px)))",
                }}
              />
              <SectionHeader
                id={`${id}-working`}
                label={language.t("sidebar.inbox.section.working")}
                expanded={props.working.expanded}
                shimmer={!props.working.expanded}
                onToggle={props.working.onToggle}
              />
              <Show when={props.working.expanded}>
                <div data-scrollable class="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
                  {props.working.rows()}
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </InboxNavigation.Provider>
  )
}

function SectionHeader(props: {
  id: string
  label: string
  expanded?: boolean
  shimmer?: boolean
  attention?: boolean
  onToggle?: () => void
}) {
  const content = (): JSX.Element => (
    <>
      <span class="min-w-0 truncate">
        <Show when={props.shimmer} fallback={props.label}>
          <TextShimmer text={props.label} active />
        </Show>
      </span>
      <Show when={props.attention || props.onToggle}>
        <span class="ms-auto flex shrink-0 items-center gap-1">
          <Show when={props.attention}>
            <span class="size-1.5 rounded-full bg-v2-state-fg-warning" aria-hidden="true" />
          </Show>
          <Show when={props.onToggle}>
            <Icon
              name="fill-triangle-down"
              size="small"
              class="shrink-0 transition-transform"
              classList={{ "-rotate-90 rtl:rotate-90": !props.expanded }}
            />
          </Show>
        </span>
      </Show>
    </>
  )

  return (
    <Show
      when={props.onToggle}
      fallback={
        <div
          id={props.id}
          class="flex h-6 shrink-0 items-center gap-1.5 px-2 text-[13px] leading-4 font-medium text-v2-text-text-muted"
        >
          {content()}
        </div>
      }
    >
      {(toggle) => (
        <button
          id={props.id}
          type="button"
          aria-expanded={props.expanded}
          class="flex h-6 w-full shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-start text-[13px] leading-4 font-medium text-v2-text-text-muted hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
          onClick={toggle()}
        >
          {content()}
        </button>
      )}
    </Show>
  )
}

export function InboxSessionCard(props: {
  project?: LocalProject
  directory: string
  title?: string
  status: InboxStatus
  server?: string
  since: number | undefined
  /** Direct subagent sessions of this row; a depth above zero renders a compact child line. */
  depth?: number
  childCount?: number
  expanded?: boolean
  onToggle?: () => void
  routine?: boolean
  selected: boolean
  now: number
  branch: string | undefined
  worktree: boolean
  archived: boolean
  onOpen: () => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
}) {
  const language = useLanguage()
  const navigation = useContext(InboxNavigation)
  const id = createUniqueId()

  const status = () => props.status

  const compact = (seconds: number) => {
    if (seconds < 3600) return language.plural("sidebar.inbox.elapsed.minutes", Math.floor(seconds / 60))

    if (seconds < 86_400) return language.plural("sidebar.inbox.elapsed.hours", Math.floor(seconds / 3600))

    return language.plural("sidebar.inbox.elapsed.days", Math.floor(seconds / 86_400))
  }

  const statusLabel = (value: InboxStatus) =>
    value === "ready" ? undefined : language.t(`sidebar.inbox.status.${value}`)

  const age = () => {
    if (props.since === undefined) return

    const seconds = Math.max(0, Math.floor((props.now - props.since) / 1000))

    if (status() === "working" && seconds < 60) return language.plural("sidebar.inbox.elapsed.seconds", seconds)

    return seconds < 60 ? language.t("sidebar.inbox.time.now") : compact(seconds)
  }

  const statusText = () => {
    if (status() === "ready") return age()

    if (status() === "working") return language.t("sidebar.inbox.status.working")

    // SAFETY: `ready` and `working` returned above, so the key is a real status.
    return language.t(`sidebar.inbox.status.${status() as Exclude<InboxStatus, "ready" | "working">}`)
  }

  // A subagent is one line: the tree carries the nesting, so the row only needs its title and how it went.
  if (props.depth) {
    return (
      <button
        type="button"
        data-slot="sidebar-inbox-item"
        data-status={status()}
        data-state={props.selected ? "active" : undefined}
        class="relative flex h-6 w-full min-w-0 shrink-0 items-center gap-1.5 rounded-[4px] pe-1.5 ps-2 text-start text-[12px] leading-4 text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover data-[state=active]:bg-v2-background-bg-layer-02"
        classList={{ "font-medium text-v2-text-text-base": props.selected }}
        onClick={props.onOpen}
      >
        {/* The elbow joining this row to the guide line. */}
        <span
          aria-hidden="true"
          class="pointer-events-none absolute start-0 top-1/2 h-px w-[7px] bg-v2-border-border-muted"
        />
        <Show when={(props.childCount ?? 0) > 0}>
          <Disclosure
            expanded={!!props.expanded}
            label={language.plural("session.activity.subagents", props.childCount ?? 0)}
            onToggle={() => props.onToggle?.()}
          />
        </Show>
        <span dir="auto" class="min-w-0 flex-1 truncate">
          {sessionTabTitle(props.title, language.t("session.tab.session"))}
        </span>
        <span
          class="shrink-0 text-[11px] tabular-nums"
          classList={{
            "text-v2-state-fg-warning": status() === "approval" || status() === "input",
            "text-v2-state-fg-info": status() === "working",
            "text-v2-state-fg-danger": status() === "failed",
            "text-v2-state-fg-success": status() === "done",
            "text-v2-text-text-faint": status() === "ready",
          }}
        >
          {statusText()}
        </span>
      </button>
    )
  }

  return (
    <Menu.Context modal={false}>
      <Menu.Context.Trigger
        as="button"
        type="button"
        id={id}
        tabIndex={navigation ? (navigation() === id ? 0 : -1) : 0}
        aria-current={props.selected ? "page" : undefined}
        data-slot="sidebar-inbox-item"
        data-status={status()}
        data-state={props.selected ? "active" : undefined}
        class="group flex h-[54px] w-full shrink-0 flex-col gap-1.5 rounded-[6px] p-2 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover data-[state=active]:bg-v2-overlay-simple-overlay-pressed"
        classList={{
          "transition-opacity hover:opacity-100 focus-visible:opacity-100": !props.selected,
          "opacity-50": props.archived && !props.selected,
        }}
        onClick={props.onOpen}
      >
        <span class="flex h-4 w-full min-w-0 shrink-0 items-center gap-2">
          <Show when={(props.childCount ?? 0) > 0}>
            <Disclosure
              expanded={!!props.expanded}
              label={language.plural("session.activity.subagents", props.childCount ?? 0)}
              onToggle={() => props.onToggle?.()}
            />
          </Show>
          <span class="flex size-4 shrink-0 items-center justify-center">
            <Show
              when={props.routine}
              fallback={
                <SessionTabAvatarView project={props.project} directory={props.directory} unread={false} />
              }
            >
              <Icon name="outline-rotate-clockwise" size="small" class="text-v2-text-text-accent" />
            </Show>
          </span>
          <span
            dir="auto"
            class="min-w-0 flex-1 truncate text-[13px] leading-4 font-medium tracking-[-0.04px] text-v2-text-text-base"
            classList={{ "text-v2-text-text-accent": props.routine }}
          >
            {sessionTabTitle(props.title, language.t("session.tab.session"))}
          </span>
        </span>
        <span class="relative flex h-4 w-full min-w-0 shrink-0 items-center gap-2 ps-6 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted">
          <Show when={props.server}>
            {(name) => (
              <Tooltip placement="right" value={name()} class="absolute start-0 top-0 flex size-4 shrink-0">
                <Icon name="server" aria-label={name()} class="text-v2-icon-icon-muted" />
              </Tooltip>
            )}
          </Show>
          <span class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-v2-icon-icon-muted">
            <span dir="auto" class="min-w-0 truncate text-v2-text-text-muted">
              {displayName(props.project ?? { worktree: props.directory })}
            </span>
            <Show when={props.worktree}>
              <Tooltip placement="right" value={props.directory} class="flex shrink-0">
                <Icon name="outline-worktree" />
              </Tooltip>
            </Show>
            <Show when={props.branch}>
              {(name) => (
                <Tooltip placement="right" value={name()} class="flex shrink-0">
                  <Icon name="branch" />
                </Tooltip>
              )}
            </Show>
          </span>
          <span class="ms-auto flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums">
            <Show when={status() !== "ready"}>
              <span class="sr-only">{statusLabel(status())}</span>
              <Show
                when={status() === "working"}
                fallback={
                  <span
                    aria-hidden="true"
                    class="size-[7px] shrink-0 rounded-full"
                    classList={{
                      "bg-v2-state-fg-warning": status() === "approval" || status() === "input",
                      "bg-v2-state-fg-danger": status() === "failed",
                      "bg-v2-background-bg-accent": status() === "done",
                    }}
                  />
                }
              >
                <ActivityRing class="shrink-0 text-v2-icon-icon-muted" />
              </Show>
            </Show>
            {/* Announce only the state, not each age update. */}
            <Show when={age()}>
              {(label) => (
                <span aria-hidden={status() === "ready" ? undefined : "true"} class="text-v2-text-text-faint">
                  {label()}
                </span>
              )}
            </Show>
          </span>
        </span>
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content>
          <Show
            when={props.archived}
            fallback={<Menu.Item onSelect={props.onArchive}>{language.t("common.archive")}</Menu.Item>}
          >
            <Menu.Item onSelect={props.onUnarchive}>{language.t("sidebar.inbox.unarchive")}</Menu.Item>
          </Show>
          <Menu.Separator />
          <Menu.Item onSelect={props.onDelete}>{language.t("common.delete")}…</Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}
