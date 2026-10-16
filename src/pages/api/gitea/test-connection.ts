import type { APIRoute } from "astro";
import { requireAuthenticatedUserId } from "@/lib/auth-guards";
import { assertSafeOutboundUrl } from "@/lib/utils/outbound-url";
import { createSecureErrorResponse } from "@/lib/utils";
import { isDestinationProviderKind, normalizeDestinationBaseUrl } from "@/lib/destination-kinds";
import { createPushTarget } from "@/lib/push-engine/targets";

export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuthenticatedUserId({ request, locals });
  if ("response" in auth) return auth.response;
  try {
    const { url, token, username, provider = "gitea" } = await request.json();
    if (!isDestinationProviderKind(provider) || !url || !token) return Response.json({ success: false, message: "A Gitea/Forgejo URL and token are required" }, { status: 400 });
    const baseUrl = normalizeDestinationBaseUrl(url, provider);
    await assertSafeOutboundUrl(baseUrl);
    const user = await createPushTarget(provider, { url: baseUrl, token, username: username || "" }).testConnection();
    if (username && user.login.toLowerCase() !== String(username).toLowerCase()) return Response.json({ success: false, message: "Token belongs to " + user.login + ", not " + username }, { status: 400 });
    return Response.json({ success: true, message: "Connected as " + user.login, user,
      serverInfo: { type: provider, version: "unknown", raw: user.label || provider } });
  } catch (error) { return createSecureErrorResponse(error, "destination connection", 400); }
};
