import { Show, createMemo, createSignal, onCleanup, type ComponentProps, type JSX } from "solid-js"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { Button } from "@opencode/ui/button"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { useI18n } from "@opencode/ui/context/i18n"
import { lastAssistantWithUsage } from "@opencode/client/solid"
import { usePlugin, type MountedSession } from "@opencode/plugin/gui"
import { catalogModel, syncCatalog } from "./catalog"
import { deepseekRate } from "./off-peak"

// DeepSeek's schedule only changes at the hour, so a slower clock is enough to keep the dot honest.
const RATE_CLOCK = 15_000

function ContextTooltipRow(props: { name: JSX.Element; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-v2-text-text-muted">{props.name}</span>
      <span class="ml-auto min-w-0 truncate text-right text-v2-text-text-base">{props.value}</span>
    </div>
  )
}

export function SessionContextUsage(props: {
  session: MountedSession
  /** False while the session's view is detached; it loads nothing until selected again. */
  active?: boolean
  variant?: "button" | "indicator"
  placement?: ComponentProps<typeof Tooltip>["placement"]
  /** The button shows only its ring and opens the usage in a menu, so a narrow header keeps room for the title. */
  compact?: boolean
}) {
  const ctx = usePlugin()
  const layout = ctx.layout
  const i18n = useI18n()
  syncCatalog(
    () => props.session,
    () => props.active !== false,
  )

  const variant = createMemo(() => props.variant ?? "button")

  // DeepSeek bills peak and off-peak rates on a UTC schedule, so the dot follows the clock rather than the session.
  const [clock, setClock] = createSignal(Date.now())
  const rateClock = setInterval(() => setClock(Date.now()), RATE_CLOCK)
  onCleanup(() => clearInterval(rateClock))

  const rate = createMemo(() => deepseekRate(new Date(clock())))

  const untilChange = createMemo(() => {
    // Rounded up so a change is never announced as "0m" before it happens.
    const minutes = Math.max(1, Math.ceil((rate().nextChange - clock()) / 60_000))

    const unit = (value: number, name: "hour" | "minute") =>
      new Intl.NumberFormat(i18n.locale(), { style: "unit", unit: name, unitDisplay: "narrow" }).format(value)

    if (minutes < 60) return unit(minutes, "minute")

    const rest = minutes % 60

    return rest ? `${unit(Math.floor(minutes / 60), "hour")} ${unit(rest, "minute")}` : unit(minutes / 60, "hour")
  })

  const messages = createMemo(() =>
    props.session.id ? props.session.server.data.session.message.list(props.session.id) : [],
  )

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(i18n.locale(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const info = createMemo(() =>
    props.session.id ? props.session.server.data.session.get(props.session.id) : undefined,
  )

  // Same step as the TUI: after the last completed compaction and before an undo boundary.
  const context = createMemo(() => {
    const message = lastAssistantWithUsage(messages(), info()?.revert?.messageID)

    if (!message) return
    const model = catalogModel(props.session, message.model)?.model

    const total =
      message.tokens.input +
      message.tokens.output +
      message.tokens.reasoning +
      message.tokens.cache.read +
      message.tokens.cache.write

    return {
      total,
      usage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const tokens = createMemo(() =>
    new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 0 })
      .format(context()?.total ?? 0)
      .toLocaleLowerCase(i18n.locale()),
  )

  // A root session's cost includes its subagent sessions, as in the TUI.
  const spent = createMemo(() => (props.session.id ? props.session.server.data.session.cost(props.session.id) : 0))

  const cost = createMemo(() => usd().format(spent()))

  // Spend anywhere in the family keeps the cost visible, even when this session's model is free.
  const showCost = createMemo(() => {
    if (spent() > 0) return true
    const ref = info()?.model ?? messages().findLast((item) => item.type === "assistant")?.model
    const model = ref ? catalogModel(props.session, ref)?.model : undefined

    if (!model) return true

    return model.cost.some((cost) => cost.input > 0 || cost.output > 0 || cost.cache.read > 0 || cost.cache.write > 0)
  })

  const openContext = () => {
    if (!props.session.id) return
    layout.toggle(`${ctx.id}:main`, props.session)
  }

  const viewContext = () => {
    if (!props.session.id) return
    layout.open(`${ctx.id}:main`, props.session)
  }

  const circle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle
        appearance="indicator"
        size={16}
        strokeWidth={2}
        percentage={context()?.usage ?? 0}
        style={{
          "--progress-circle-background": "var(--v2-background-bg-layer-04)",
          "--progress-circle-background-overlay": "var(--v2-overlay-simple-overlay-pressed, transparent)",
          "--progress-circle-progress": "var(--v2-icon-icon-base, var(--icon-base))",
        }}
      />
    </div>
  )

  const compactCircle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle appearance="compact" size={16} percentage={context()?.usage ?? 0} />
    </div>
  )

  const rateDot = () => (
    <span
      aria-hidden="true"
      class="size-1.5 shrink-0 rounded-full"
      style={{
        background: rate().peak ? "var(--v2-state-fg-danger)" : "var(--v2-state-fg-success)",
      }}
    />
  )

  const rateLabel = () => (rate().peak ? ctx.t("usage.rate.peak") : ctx.t("usage.rate.offPeak"))

  const rateRow = () => <ContextTooltipRow name={rateLabel()} value={ctx.t("usage.rate.until", { time: untilChange() })} />

  const menuRow = (name: JSX.Element, value: JSX.Element) => (
    <div class="flex h-7 min-w-0 items-center gap-4 px-3 text-[13px] font-[440] leading-[var(--line-height-compact)] tracking-[-0.04px]">
      <span class="shrink-0 text-v2-text-text-muted">{name}</span>
      <span class="ml-auto min-w-0 truncate text-right tabular-nums text-v2-text-text-base">{value}</span>
    </div>
  )

  const rateMenuRow = () => menuRow(rateLabel(), ctx.t("usage.rate.until", { time: untilChange() }))

  // The button's tooltip carries the rate and what a click does; the tab label already shows the session's numbers.
  const buttonTooltip = () => (
    <div class="flex w-[180px] flex-col gap-2">
      {rateRow()}
      <div class="text-v2-text-text-muted">{ctx.t("usage.toggle")}</div>
    </div>
  )

  const tooltipValue = () => (
    <div class="flex w-[120px] flex-col gap-2">
      {rateRow()}
      <Show when={showCost()}>
        <ContextTooltipRow name={ctx.t("usage.cost")} value={cost()} />
      </Show>
      <ContextTooltipRow name={ctx.t("usage.usage")} value={`${context()?.usage ?? 0}%`} />
      <ContextTooltipRow name={ctx.t("usage.tokens")} value={context()?.total.toLocaleString(i18n.locale()) ?? "0"} />
    </div>
  )

  const usageMenu = () => (
    <Menu placement="bottom-end" gutter={4} modal={false}>
      <Tooltip value={ctx.t("usage.view")} placement={props.placement ?? "top"}>
        <Menu.Trigger
          as={Button}
          type="button"
          variant="ghost-muted"
          class="group shrink-0"
          style={{ padding: "0 6px", color: "var(--v2-text-text-faint)" }}
          aria-label={ctx.t("usage.view")}
        >
          {compactCircle()}
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal>
        <Menu.Content class="w-[200px] max-w-[calc(100vw-16px)]" aria-label={ctx.t("usage.view")}>
          {rateMenuRow()}
          {menuRow(ctx.t("usage.tokens"), context()?.total.toLocaleString(i18n.locale()) ?? "0")}
          <Show when={showCost()}>{menuRow(ctx.t("usage.cost"), cost())}</Show>
          {menuRow(ctx.t("usage.usage"), `${context()?.usage ?? 0}%`)}
          <Menu.Separator />
          <Menu.Item onSelect={viewContext}>{ctx.t("usage.view")}</Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )

  return (
    <Show when={props.session.id}>
      <Show when={!props.compact} fallback={usageMenu()}>
        <Show
          when={variant() === "indicator"}
          fallback={
            <Tooltip value={buttonTooltip()} placement={props.placement ?? "top"}>
              <Button
                type="button"
                variant="ghost-muted"
                class="group shrink-0"
                style={{ padding: "0 6px", color: "var(--v2-text-text-faint)" }}
                onClick={openContext}
                aria-expanded={layout.state(`${ctx.id}:main`, props.session) === "visible"}
                aria-label={ctx.t("usage.toggle")}
              >
                <span class="flex items-center gap-2 whitespace-nowrap group-active:text-v2-text-text-muted">
                  <span class="flex items-center gap-1.5">
                    {rateDot()}
                    {compactCircle()}
                  </span>
                  <span>{tokens()}</span>
                  <Show when={showCost()}>
                    <span aria-hidden="true" class="flex w-1.5 shrink-0 items-center justify-center">
                      ·
                    </span>
                    <span>{cost()}</span>
                  </Show>
                </span>
              </Button>
            </Tooltip>
          }
        >
          <Tooltip value={tooltipValue()} placement={props.placement ?? "top"}>
            {circle()}
          </Tooltip>
        </Show>
      </Show>
    </Show>
  )
}
