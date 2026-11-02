import { describe, expect, it } from "bun:test"
import { evaluate } from "@opencode/core/permission"
import { modelRef, permissions } from "@opencode/core/routine/execution"

describe("Routine execution", () => {
  it("maps the routine model to Model.Ref", () => {
    const plain = modelRef({ providerID: "openai", modelID: "gpt-5" })
    expect(String(plain.providerID)).toBe("openai")
    expect(String(plain.id)).toBe("gpt-5")
    expect(plain.variant).toBeUndefined()

    const variant = modelRef({ providerID: "anthropic", modelID: "claude", variant: "fast" })
    expect(String(variant.providerID)).toBe("anthropic")
    expect(String(variant.id)).toBe("claude")
    expect(String(variant.variant)).toBe("fast")
  })

  it("yolo allows every action except questions", () => {
    const rules = permissions("yolo")
    expect(evaluate("bash", "*", rules).effect).toBe("allow")
    expect(evaluate("edit", "src/a.ts", rules).effect).toBe("allow")
    expect(evaluate("question", "*", rules).effect).toBe("deny")
  })

  it("read_only allows reads and denies everything else", () => {
    const rules = permissions("read_only")
    for (const action of ["read", "grep", "glob", "list"]) {
      expect(evaluate(action, "*", rules).effect).toBe("allow")
    }
    for (const action of ["bash", "edit", "write", "question"]) {
      expect(evaluate(action, "*", rules).effect).toBe("deny")
    }
  })

  it("appends routine rules after the mode's base rules", () => {
    const rules = permissions("yolo", [
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "skill", resource: "*", effect: "deny" },
      { action: "skill", resource: "trello", effect: "allow" },
    ])

    expect(evaluate("bash", "*", rules).effect).toBe("allow")
    expect(evaluate("subagent", "*", rules).effect).toBe("deny")
    expect(evaluate("skill", "trello", rules).effect).toBe("allow")
    expect(evaluate("skill", "code-review-and-quality", rules).effect).toBe("deny")
  })

  it("keeps the skill tool reachable when a wildcard deny is followed by an allow", () => {
    const rules = permissions("yolo", [
      { action: "skill", resource: "*", effect: "deny" },
      { action: "skill", resource: "trello", effect: "allow" },
    ])

    // Tool.snapshot wholly disables a tool only when the last matching action rule is a wildcard deny.
    expect(rules.findLast((rule) => rule.action === "skill")?.effect).toBe("allow")
  })
})
