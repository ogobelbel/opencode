import { Icon } from "@opencode/ui/icon"

/** A chevron that reveals a row's child sessions without opening the row itself. */
export function Disclosure(props: { expanded: boolean; label: string; onToggle: () => void }) {
  return (
    <span
      role="button"
      tabindex="0"
      aria-expanded={props.expanded}
      aria-label={props.label}
      class="flex size-4 shrink-0 items-center justify-center rounded-[4px] hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
      onClick={(event) => {
        event.stopPropagation()
        props.onToggle()
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        event.stopPropagation()
        props.onToggle()
      }}
    >
      <Icon
        name="chevron-down"
        size="small"
        class="transition-transform"
        classList={{ "-rotate-90 rtl:rotate-90": !props.expanded }}
      />
    </span>
  )
}
