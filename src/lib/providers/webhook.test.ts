import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createHmac } from "node:crypto";
import { sendWebhookNotification } from "./webhook";
import type { NotificationEvent } from "./ntfy";
import type { WebhookConfig } from "@/types/config";

describe("sendWebhookNotification", () => {
  let mockFetch: ReturnType<typeof mock>;
  let originalFetch: typeof fetch;

  afterEach(() => { globalThis.fetch = originalFetch; });

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = mock(() =>
      Promise.resolve(new Response("ok", { status: 200 }))
    );
    globalThis.fetch = mockFetch as any;
  });

  const baseConfig: WebhookConfig = {
    url: "https://example.com/hooks/hf-mirror",
  };

  const baseEvent: NotificationEvent = {
    title: "Test Notification",
    message: "This is a test",
    type: "sync_success",
  };

  test("posts to the configured URL", async () => {
    await sendWebhookNotification(baseConfig, baseEvent);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/hooks/hf-mirror");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  test("sends title, message, type, and timestamp in JSON body", async () => {
    await sendWebhookNotification(baseConfig, baseEvent);

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.title).toBe("Test Notification");
    expect(body.message).toBe("This is a test");
    expect(body.type).toBe("sync_success");
    expect(new Date(body.timestamp).getTime()).not.toBeNaN();
  });

  test("omits signature header when no secret is configured", async () => {
    await sendWebhookNotification(baseConfig, baseEvent);

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["X-Webhook-Signature"]).toBeUndefined();
  });

  test("signs the body with HMAC-SHA256 when a secret is configured", async () => {
    await sendWebhookNotification(
      { ...baseConfig, secret: "my-secret" },
      baseEvent
    );

    const [, opts] = mockFetch.mock.calls[0];
    const expected = createHmac("sha256", "my-secret").update(opts.body).digest("hex");
    expect(opts.headers["X-Webhook-Signature"]).toBe(`sha256=${expected}`);
  });

  test("throws on non-200 response", async () => {
    mockFetch = mock(() =>
      Promise.resolve(new Response("unauthorized", { status: 401 }))
    );
    globalThis.fetch = mockFetch as any;

    await expect(
      sendWebhookNotification(baseConfig, baseEvent)
    ).rejects.toThrow("Webhook error: 401");
  });
});
