import { describe, expect, it } from "bun:test";
import { isMirrorableSourceRepository } from "@/lib/repo-eligibility";

describe("isMirrorableSourceRepository", () => {
  it("returns false for disabled repos", () => {
    expect(isMirrorableSourceRepository({ isDisabled: true })).toBe(false);
  });

  it("returns true for enabled repos", () => {
    expect(isMirrorableSourceRepository({ isDisabled: false })).toBe(true);
  });

  it("returns true when disabled flag is absent", () => {
    expect(isMirrorableSourceRepository({})).toBe(true);
  });
});
