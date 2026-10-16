import { repositorySchema } from "@/lib/db/schema";
import type { APIRoute } from "astro";
import { db, configs, repositories } from "@/lib/db";
import { and, eq, inArray, sql } from "drizzle-orm";

import { createSecureErrorResponse } from "@/lib/utils";
import { requireAuthenticatedUserId } from "@/lib/auth-guards";

import { createMirrorJob } from "@/lib/helpers";

interface ApproveSyncRequest {
  repositoryIds: string[];
  action: "approve" | "dismiss";
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const authResult = await requireAuthenticatedUserId({ request, locals });
    if ("response" in authResult) return authResult.response;
    const userId = authResult.userId;

    const body: ApproveSyncRequest = await request.json();
    const { repositoryIds, action } = body;

    if (!repositoryIds || !Array.isArray(repositoryIds) || repositoryIds.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: "repositoryIds are required." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    if (action !== "approve" && action !== "dismiss") {
      return new Response(
        JSON.stringify({ success: false, message: "action must be 'approve' or 'dismiss'." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
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
    if (!config) {
      return new Response(
        JSON.stringify({ success: false, message: "No configuration found." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Fetch repos — only those in pending-approval status
    const repos = await db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.userId, userId),
          eq(repositories.status, "pending-approval"),
          inArray(repositories.id, repositoryIds),
        ),
      );

    if (!repos.length) {
      return new Response(
        JSON.stringify({ success: false, message: "No pending-approval repositories found for the given IDs." }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    if (action === "dismiss") {
      // Reset status to "synced" so repos resume normal schedule
      for (const repo of repos) {
        await db
          .update(repositories)
          .set({
            status: "synced",
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(repositories.id, repo.id));

        await createMirrorJob({
          userId,
          repositoryId: repo.id,
          repositoryName: repo.name,
          message: `Force-push alert dismissed for ${repo.name}`,
          details: "User dismissed the force-push alert. Repository will resume normal sync schedule.",
          status: "synced",
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Dismissed ${repos.length} repository alert(s).`,
          repositories: repos.map((repo) => ({
            ...repo,
            status: "synced",
            errorMessage: null,
          })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // action === "approve": create backup first (safety), then trigger sync

    // Claim the rows before the background work starts: one conditional UPDATE
    // per repository, so the status flips to "syncing" immediately (the UI asks
    // for that) without stealing a row that a mirror or sync already owns
    // (#417). The sync itself is then told the row is claimed.
    const claimedRepos: typeof repos = [];
    for (const repo of repos) {
      const claimed = await db
        .update(repositories)
        .set({
          status: "syncing",
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(repositories.id, repo.id),
            eq(repositories.status, "pending-approval"),
          ),
        )
        .returning({ id: repositories.id });

      if (claimed.length > 0) {
        claimedRepos.push(repo);
      } else {
        console.log(
          `[ApproveSync] Skipping ${repo.name}: it is no longer waiting for approval (another run may have picked it up).`,
        );
      }
    }

    if (claimedRepos.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "No pending-approval repositories were available to sync.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }

    // Process in background
    setTimeout(async () => {
      for (const repo of claimedRepos) {
        try {
          const { pushMirrorRepository } = await import("@/lib/push-engine/mirror");
          await pushMirrorRepository({ config, repository: repositorySchema.parse({ ...repo, mirroredLocation: repo.mirroredLocation ?? "" }), mode: "sync", approved: true });
        } catch (error) {
          console.error(
            `[ApproveSync] Failed to sync approved repository ${repo.name}:`,
            error,
          );
        }
      }
    }, 0);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Approved sync for ${claimedRepos.length} repository(ies). Backup + sync started.`,
        repositories: claimedRepos.map((repo) => ({
          ...repo,
          status: "syncing",
          errorMessage: null,
        })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    return createSecureErrorResponse(error, "approve-sync", 500);
  }
};
