import type { APIRoute } from "astro";
import { requireAuthenticatedUserId } from "@/lib/auth-guards";
import { listSources } from "@/lib/sources";
import { sourceConnectionFromSource } from "@/lib/source-providers";
import { HuggingFaceSourceProvider } from "@/lib/source-providers/huggingface";
import { createSecureErrorResponse } from "@/lib/utils";

export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuthenticatedUserId({ request, locals });
  if ("response" in auth) return auth.response;
  try {
    const sources = await listSources(auth.userId);
    const sourceId = new URL(request.url).searchParams.get("sourceId");
    const source = sourceId ? sources.find(s => s.id === sourceId) : sources[0];
    if (!source) return Response.json({ success: false, error: "Source not found" }, { status: 404 });
    const provider = new HuggingFaceSourceProvider(sourceConnectionFromSource(source));
    const collections = await provider.paginate<{ slug: string; title: string }>(`/api/collections?owner=${encodeURIComponent(source.username)}&limit=100`);
    return Response.json({ success: true, collections, lists: collections.map(c => c.slug) });
  } catch (error) { return createSecureErrorResponse(error, "HF collections", 500); }
};
