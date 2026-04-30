import { describe, expect, it } from "vitest";
import { reviseSource } from "../shared/reviser";

describe("reviseSource", () => {
  it("strips fences and canonicalizes valid Mermaid", () => {
    const result = reviseSource(`\`\`\`mermaid
flowchart TD
A["Start"]-->B["Done"]
\`\`\``);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected revised Mermaid");
    expect(result.source).toBe(`flowchart TD
  A["Start"]
  B["Done"]

  A --> B
`);
  });

  it("adds a missing top-down header and normalizes common arrows", () => {
    const result = reviseSource(`A["Start"] → B["Done"]`);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected revised Mermaid");
    expect(result.source).toContain("flowchart TD");
    expect(result.source).toContain("A --> B");
  });

  it("returns a local parse error instead of using network calls", () => {
    const result = reviseSource(`A[Missing`);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Unterminated");
  });

  it("revises Mermaid journey syntax without converting it into a flowchart", () => {
    const result = reviseSource(`\`\`\`mermaid
journey
  title Accessibility-conscious user checking control and readability
  section Setup
    Opens Settings: 5: User
    Enables reduce motion or high contrast: 5: User
\`\`\``);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected revised journey");
    expect(result.source).toContain("journey");
    expect(result.source).toContain("title Accessibility-conscious user checking control and readability");
    expect(result.source).toContain("Opens Settings: 5: User");
  });

  it("removes exact duplicate statements while keeping valid output", () => {
    const result = reviseSource(`flowchart TD
  A[Start]
  A[Start]
  A --> B[Done]
  A --> B[Done]`);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected revised Mermaid");
    expect(result.source.match(/A\["Start"\]/g)?.length ?? 0).toBe(1);
    expect(result.source.match(/A --> B/g)?.length ?? 0).toBe(1);
  });

  it("blocks conflicting duplicate node labels instead of guessing", () => {
    const result = reviseSource(`flowchart TD
  A[Start]
  A[Different]
  A --> B[Done]`);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("conflicting labels");
  });

});
