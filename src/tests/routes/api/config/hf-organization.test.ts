import { describe, expect, test } from "bun:test";
import { POST } from "@/pages/api/config/index";

describe("POST /api/config HF organization validation", () => {
  for (const hfReposOrg of ["https://forge.example/org", "owner/repo", "my org", "../org", 123, null]) {
    test(`rejects invalid organization ${JSON.stringify(hfReposOrg)}`, async () => {
      const response = await POST({
        request: new Request("http://localhost/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceConfig: { username: "alice", token: "" },
            giteaConfig: { url: "https://forge.example", username: "me", token: "", hfReposOrg },
            scheduleConfig: {}, cleanupConfig: {}, mirrorOptions: {}, advancedOptions: {},
          }),
        }),
        locals: { session: { userId: "user-1" } },
      } as any);
      expect(response.status).toBe(400);
      expect((await response.json()).message).toContain("Invalid HF repositories organization");
    });
  }
});
