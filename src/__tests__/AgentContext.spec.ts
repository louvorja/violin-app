import { describe, expect, it } from "vitest";
import { validateAgentContext } from "../../scripts/validate-agent-context";

describe("agent context", () => {
  it("matches the current application architecture", () => {
    expect(validateAgentContext()).toEqual([]);
  });
});
