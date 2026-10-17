# Authentication

HF Mirror uses Better Auth backed by SQLite. Email/password, registered
OIDC/SAML providers, API keys, and trusted reverse-proxy headers are separate
authentication mechanisms. Source and destination tokens are credentials for
external hosts, not credentials for signing in to HF Mirror.

## First account and local sign-in

Create the first account at `/signup`, then sign in at `/login`. Email/password
registration is closed after any account exists. Set `AUTH_ALLOW_SIGNUP=true`
only when intentionally allowing additional local registrations. Registered SSO
and proxy auto-provisioning are separate operator-configured flows.

Set a stable `BETTER_AUTH_SECRET` and the browser-facing `BETTER_AUTH_URL`.
Additional permitted browser origins can be set as a comma-separated
`BETTER_AUTH_TRUSTED_ORIGINS`. A proxy must preserve the intended public scheme
and host; mismatches can cause cookie, redirect, and origin validation failures.
For a path deployment, also set `BASE_URL`; see [deployment](./deployment.md).

The account menu supports changing email and password. For operator recovery:

```sh
docker compose exec hf-mirror bun run manage-db reset-password --email=admin@example.com --new-password='replace-with-a-unique-password'
```

This resets one user's credential and clears that user's active sessions. Use a
private terminal: command-line passwords can appear in history or process lists.
See [commands](./commands.md) before considering `reset-users`, which deletes
accounts and related data rather than recovering one password.

## API keys

Create a named key in Configuration while signed in. The plaintext is shown at
creation; save it securely. Names are limited to 32 characters. Expiry choices
include never, 30 days, 90 days, and one year. Keys retain the `gm_` prefix from
gitea-mirror and are sent in the `x-api-key` request header.

```sh
curl -H "x-api-key: $HF_MIRROR_API_KEY" http://localhost:5321/api/dashboard
```

An API key acts with its user's access. Keys are not individually rate-limited
by the configured plugin. Revoke a key to stop its use. Key-authenticated calls
cannot create, list, or revoke API keys; those management actions require a real
sign-in. Do not use an HF or Gitea token in place of an HF Mirror API key.
See [API](./api.md) for endpoint examples.

## OIDC providers

1. Create a client on your identity provider and choose a stable provider ID.
2. On Configuration's SSO settings, register the issuer, client ID, client secret,
   and domain. Discovery normally uses `ISSUER/.well-known/openid-configuration`.
3. Register the exact redirect URL displayed by the UI with your IdP:
   `PUBLIC_URL/api/auth/sso/callback/PROVIDER_ID`. Include `BASE_URL` if used.
4. Request `openid`, `email`, and `profile` scopes unless your provider needs a
   different mapping. Configure explicit endpoints or claim mapping when needed.
5. Test sign-in in another browser session before relying on SSO for access.

Discovery validates endpoint data and times out after ten seconds. Registered
provider issuer and endpoint origins are added to auth trusted origins, allowing
operator-configured internal IdPs. Keep those registrations restricted to
infrastructure you control. After changing the public URL, update registered
redirects on the IdP too.

## SAML and OAuth applications

SSO settings also accept SAML provider configuration, including IdP metadata and
certificates. The displayed callback is
`PUBLIC_URL/api/auth/sso/saml2/callback/PROVIDER_ID`. SP metadata is available at
`/api/auth/sso/sp-metadata?providerId=PROVIDER_ID`; registration details and
claim mappings depend on your IdP.

OAuth application management lets other clients register redirect URLs and use
HF Mirror's authorization server. This is distinct from configuring an upstream
IdP for HF Mirror login. Application management and registration endpoints are
listed in [API](./api.md). Review redirect URLs carefully.

## Trusted proxy headers

Enable header authentication only behind an authenticating proxy. Ensure clients
cannot bypass that proxy, and make the proxy remove untrusted incoming identity
headers before injecting its own values.

| Variable | Default / meaning |
| --- | --- |
| `HEADER_AUTH_ENABLED` | `false`; set `true` to enable |
| `HEADER_AUTH_USER_HEADER` | `X-Authentik-Username` |
| `HEADER_AUTH_EMAIL_HEADER` | `X-Authentik-Email` |
| `HEADER_AUTH_NAME_HEADER` | `X-Authentik-Name` |
| `HEADER_AUTH_AUTO_PROVISION` | `false`; `true` permits creation from trusted headers |
| `HEADER_AUTH_ALLOWED_DOMAINS` | Optional comma-separated email domains |
| `AUTH_DEFAULT_METHOD` | Preferred login tab: `email` or `sso`; browser's last available method takes precedence |
| `AUTH_ALLOW_SIGNUP` | `false`; explicitly opens local signup when `true` |

The username header is required. Provision existing users or intentionally enable
auto-provisioning. Domain filtering applies to a supplied email; it is not a
substitute for the trusted-proxy boundary. The middleware exchanges trusted
headers for a real session and returns cookies used by the React client.
Compose requires an explicit environment mapping for these optional variables.

For failures, read [troubleshooting](./troubleshooting.md) and inspect
[auth.ts](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/src/lib/auth.ts), [auth-header.ts](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/src/lib/auth-header.ts), and
[oidc-config.ts](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/src/lib/sso/oidc-config.ts).
