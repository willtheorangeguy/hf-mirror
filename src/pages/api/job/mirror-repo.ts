import type { APIRoute } from "astro";

import type { MirrorRepoRequest, MirrorRepoResponse } from "@/types/mirror";
import { db, configs, repositories } from "@/lib/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { repositoryVisibilityEnum, repoStatusEnum } from "@/types/Repository";

import { createSecureErrorResponse } from "@/lib/utils";
import { requireAuthenticatedUserId } from "@/lib/auth-guards";
import { repositorySchema } from "@/lib/db/schema";
import { mirrorRepositoryToDestination } from "@/lib/mirror-dispatch";
import { processWithResilience } from "@/lib/utils/concurrency";

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const authResult = await requireAuthenticatedUserId({ request, locals });
    if ("response" in authResult) return authResult.response;
    const userId = authResult.userId;

    const body: MirrorRepoRequest = await request.json();
    const { repositoryIds } = body;

    if (!repositoryIds || !Array.isArray(repositoryIds)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "repositoryIds are required.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (repositoryIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "No repository IDs provided.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch config — prefer active and most-recently-updated to avoid picking
    // a stale inactive stub when multiple rows exist (see issue #271).
    const configResult = await db
      .select()
      .from(configs)
      .where(eq(configs.userId, userId))
      .orderBy(sql`${configs.isActive} DESC`, sql`${configs.updatedAt} DESC`)
      .limit(1);

    const config = configResult[0];

    if (!config || !config.giteaConfig?.token) {
      return new Response(
        JSON.stringify({ error: "Config missing for the user or destination token." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch repos
    const repos = await db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.userId, userId),
          inArray(repositories.id, repositoryIds)
        )
      );

    if (!repos.length) {
      return new Response(
        JSON.stringify({ error: "No repositories found for the given IDs." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Start async mirroring in background with parallel processing and resilience
    setTimeout(async () => {
      try {
        await processWithResilience(repos, async (repo) => {
          await mirrorRepositoryToDestination({
            config,
            repository: repositorySchema.parse({ ...repo, mirroredLocation: repo.mirroredLocation ?? "" }),
          });
          return repo;
        }, {
          userId,
          jobType: "mirror",
          getItemId: (repo) => repo.id,
          getItemName: (repo) => repo.name,
          concurrencyLimit: 3,
          maxRetries: 2,
          retryDelay: 2000,
          checkpointInterval: 5,
        });
      } catch (error) {
        console.error("Repository mirror batch failed", error);
      }
    }, 0);

    const responsePayload: MirrorRepoResponse = {
      success: true,
      message: "Mirror job started.",
      repositories: repos.map((repo) => ({
        ...repo,
        status: repoStatusEnum.parse(repo.status),
        organization: repo.organization ?? undefined,
        lastMirrored: repo.lastMirrored ?? undefined,
        errorMessage: repo.errorMessage ?? undefined,
        forkedFrom: repo.forkedFrom ?? undefined,
        visibility: repositoryVisibilityEnum.parse(repo.visibility),
        mirroredLocation: repo.mirroredLocation || "",
      })),
    };

    // Return the updated repo list to the user
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    // Enhanced error logging for better debugging
    console.error("=== ERROR MIRRORING REPOSITORIES ===");
    console.error("Error type:", error?.constructor?.name);
    console.error(
      "Error message:",
      error instanceof Error ? error.message : String(error)
    );

    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }

    // Log additional context
    console.error("Request details:");
    console.error("- URL:", request.url);
    console.error("- Method:", request.method);
    console.error("- Headers:", Object.fromEntries(request.headers.entries()));

    // If it's a JSON parsing error, provide more context
    if (error instanceof SyntaxError && error.message.includes("JSON")) {
      console.error("🚨 JSON PARSING ERROR DETECTED:");
      console.error(
        "This suggests the response from Gitea API is not valid JSON"
      );
      console.error("Common causes:");
      console.error("- Gitea server returned HTML error page instead of JSON");
      console.error("- Network connection interrupted");
      console.error("- Gitea server is down or misconfigured");
      console.error("- Authentication token is invalid");
      console.error("Check your Gitea server logs and configuration");
    }

    console.error("=====================================");

    return createSecureErrorResponse(error, "mirror-repo API", 500);
  }
};
