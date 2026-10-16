import type { APIRoute } from "astro";
import { requireAuthenticatedUserId } from "@/lib/auth-guards";
import { cancelActiveMirror } from "@/lib/push-engine/mirror";
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuthenticatedUserId({ request, locals });
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => null);
  if (typeof body?.repositoryId !== "string") return Response.json({ success: false, error: "repositoryId is required" }, { status: 400 });
  const cancelled = cancelActiveMirror(body.repositoryId, auth.userId);
  return Response.json({ success: cancelled, message: cancelled ? "Cancellation requested; downloaded objects are retained" : "No active mirror found" }, { status: cancelled ? 200 : 404 });
};
