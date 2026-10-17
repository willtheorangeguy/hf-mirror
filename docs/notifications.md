# Notifications

Configure notifications on Configuration. Notifications start disabled. Choose
one provider, enter its settings, select events, save, and send a test message.
Provider credentials are stored with the configuration; treat database backups
and encryption secrets as sensitive.

## Providers

| Provider | Required settings | Optional settings |
| --- | --- | --- |
| ntfy | Server URL and topic | Token; priority `min`, `low`, `default`, `high`, or `urgent` |
| Apprise | Apprise API URL and configuration token/key | Tag |
| Gotify | Server URL and application token | Numeric priority 0–10; default 5 |
| Webhook | HTTP(S) receiver URL | Shared secret for HMAC signing |

ntfy's default URL is `https://ntfy.sh`; choose a private authenticated topic or
your own server when notifications identify private repositories. Apprise expects
an API server and its configuration key, not a destination's individual service
URL. Test from the running container's network context: `localhost` inside a
container refers to that container.

Event preferences are `notifyOnSyncError` (default true), `notifyOnSyncSuccess`
(false), and `notifyOnNewRepo` (false). They apply when the relevant workflow
emits a notification; a test message checks delivery independently.

## Webhook contract

The receiver gets a JSON POST with this shape:

```json
{
  "title": "HF-mirror - Test Notification",
  "message": "Message text",
  "type": "sync_success",
  "timestamp": "2026-10-16T12:00:00.000Z"
}
```

If a secret is configured, `X-Webhook-Signature` contains
`sha256=HEX_DIGEST`, an HMAC-SHA256 over the exact request body bytes. Verify the
signature before parsing or trusting the message; use a constant-time comparison
and your own replay policy if required. Return a successful HTTP status to
acknowledge delivery. The sender treats a non-2xx response as a failure.

## Delivery and troubleshooting

The UI's test request sends `notificationConfig` to
`POST /api/notifications/test` and reports success or a sanitized error.
Normal notification failures are logged and caught so a notification outage
does not itself throw out of the mirror workflow. Delivery is not a durable
message queue and should not be your only record of backup success.

Check the URL, token, topic/key, receiver logs, DNS, and CA trust if a test fails.
Outbound URL checks permit private-network services but refuse link-local and
cloud metadata destinations and do not follow redirects. Use the final API
endpoint rather than a redirecting URL. See [deployment](./deployment.md) for
private CA certificates and [troubleshooting](./troubleshooting.md) for diagnostics.

Implementation: [notification-service.ts](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/src/lib/notification-service.ts)
and the [provider modules](https://github.com/willtheorangeguy/hf-mirror/tree/HEAD/src/lib/providers/).
