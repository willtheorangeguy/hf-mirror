import type { APIRoute } from "astro";
import {
  SOURCE_PROVIDER_LABELS,
  isSourceProviderKind,
  isValidSourceUrl,
  normalizeSourceProviderKind,
} from "@/lib/source-providers/kinds";
import { evaluateConfigChange, loadConfigLocks } from "@/lib/config-locks";
import {
  DESTINATION_PROVIDER_DEFAULT_URLS,
  isDestinationProviderKind,
  isPushDestinationKind,
  normalizeDestinationProviderKind,
} from "@/lib/destination-kinds";
import { db, configs, users } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { eq, sql } from "drizzle-orm";
import { createSecureErrorResponse } from "@/lib/utils";
import {
  mapUiToDbConfig,
  mapDbToUiConfig,
  mapUiScheduleToDb,
  mapUiCleanupToDb,
  mapDbScheduleToUi,
  mapDbCleanupToUi
} from "@/lib/utils/config-mapper";
import { encrypt, decrypt } from "@/lib/utils/encryption";
import { createDefaultConfig } from "@/lib/utils/config-defaults";
import { requireAuthenticatedUserId } from "@/lib/auth-guards";
import { blockedOutboundUrlReason } from "@/lib/utils/outbound-url";
import { notificationConfigSchema } from "@/lib/db/schema";
import {
  loadSourceApiItems,
  type SourceApiItem,
} from "@/lib/sources-api";

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const authResult = await requireAuthenticatedUserId({ request, locals });
    if ("response" in authResult) return authResult.response;
    const userId = authResult.userId;

    const body = await request.json();
    if (body.sourceConfig?.provider && body.sourceConfig.provider !== "huggingface") return new Response(JSON.stringify({ success: false, message: "HF-mirror supports Hugging Face sources only" }), { status: 400 });
    if (body.giteaConfig?.provider && !["gitea", "forgejo"].includes(body.giteaConfig.provider)) return new Response(JSON.stringify({ success: false, message: "Choose a Gitea or Forgejo destination" }), { status: 400 });
    const {
      sourceConfig,
      giteaConfig,
      scheduleConfig,
      cleanupConfig,
      mirrorOptions,
      advancedOptions,
      notificationConfig,
      confirmSourceChange,
      confirmDestinationChange,
    } = body;
    if (sourceConfig?.repoTypes !== undefined && (!Array.isArray(sourceConfig.repoTypes) || !sourceConfig.repoTypes.every((type: unknown) => ["model", "dataset", "space"].includes(type as string)))) {
      return Response.json({ success: false, message: "repoTypes must be an array of model, dataset, or space" }, { status: 400 });
    }
    if (sourceConfig?.collections !== undefined && (!Array.isArray(sourceConfig.collections) || !sourceConfig.collections.every((slug: unknown) => typeof slug === "string" && /^[^/\s]+\/[^/\s]+$/.test(slug)))) {
      return Response.json({ success: false, message: "collections must contain owner/collection slugs" }, { status: 400 });
    }

    if (!sourceConfig || !giteaConfig || !scheduleConfig || !cleanupConfig || !mirrorOptions || !advancedOptions) {
      return new Response(
        JSON.stringify({
          success: false,
          message:
            "sourceConfig, giteaConfig, scheduleConfig, cleanupConfig, mirrorOptions, and advancedOptions are required.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    let validatedNotificationConfig: any = undefined;
    if (notificationConfig !== undefined) {
      const parsed = notificationConfigSchema.safeParse(notificationConfig);
      if (!parsed.success) {
        return new Response(
          JSON.stringify({
            success: false,
            message: `Invalid notificationConfig: ${parsed.error.message}`,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      validatedNotificationConfig = parsed.data;
    }

    // Validate Gitea URL format and protocol
    if (giteaConfig.url) {
      try {
        const giteaUrl = new URL(giteaConfig.url);
        if (!['http:', 'https:'].includes(giteaUrl.protocol)) {
          return new Response(
            JSON.stringify({ success: false, message: "Gitea URL must use http or https protocol." }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
      } catch {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid Gitea URL format." }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      const blockedDestination = await blockedOutboundUrlReason(giteaConfig.url);
      if (blockedDestination) {
        return new Response(
          JSON.stringify({ success: false, message: blockedDestination }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // their public instance when no URL is given.
    if (giteaConfig.provider !== undefined && !isDestinationProviderKind(giteaConfig.provider)) {
      return new Response(
        JSON.stringify({ success: false, message: "Unknown destination provider." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const destinationProvider = normalizeDestinationProviderKind(giteaConfig.provider);
    if (
      isPushDestinationKind(destinationProvider) &&
      !(typeof giteaConfig.url === "string" && giteaConfig.url.trim())
    ) {
      giteaConfig.url = DESTINATION_PROVIDER_DEFAULT_URLS[destinationProvider];
    }

    if (sourceConfig.provider !== undefined && !isSourceProviderKind(sourceConfig.provider)) {
      return new Response(
        JSON.stringify({ success: false, message: "Unknown source provider." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const sourceProvider = normalizeSourceProviderKind(sourceConfig.provider);
    {
      const rawSourceUrl = typeof sourceConfig.url === "string" ? sourceConfig.url.trim() : "";
      if (rawSourceUrl && !isValidSourceUrl(rawSourceUrl)) {
        return new Response(
          JSON.stringify({
            success: false,
            message: `${SOURCE_PROVIDER_LABELS[sourceProvider]} URL must be a valid http or https URL.`,
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      const blockedSource = rawSourceUrl ? await blockedOutboundUrlReason(rawSourceUrl) : null;
      if (blockedSource) {
        return new Response(
          JSON.stringify({ success: false, message: blockedSource }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Fetch existing config — prefer the active config; fall back to most-recently-updated
    // so a stale inactive stub never wins over a populated active row (see issue #271).
    const existingConfigResult = await db
      .select()
      .from(configs)
      .where(eq(configs.userId, userId))
      .orderBy(sql`${configs.isActive} DESC`, sql`${configs.updatedAt} DESC`)
      .limit(1);

    const existingConfig = existingConfigResult[0];

    // Parse the stored configs once — used both to preserve fields the
    // Configuration form doesn't expose (e.g. env-configured mirrorInterval,
    // see issue #338) and to preserve tokens when the form submits them empty.
    let existingSource: Record<string, any> | undefined;
    let existingGitea: Record<string, any> | undefined;
    if (existingConfig) {
      try {
        existingSource =
          typeof existingConfig.sourceConfig === "string"
            ? JSON.parse(existingConfig.sourceConfig)
            : existingConfig.sourceConfig;

        existingGitea =
          typeof existingConfig.giteaConfig === "string"
            ? JSON.parse(existingConfig.giteaConfig)
            : existingConfig.giteaConfig;
      } catch (parseError) {
        console.error("Failed to parse existing config:", parseError);
      }
    }

    // A locked source or destination only changes with explicit confirmation.
    if (existingConfig) {
      const locks = await loadConfigLocks(userId);
      const verdict = evaluateConfigChange({
        locks,
        existingSource: existingSource,
        incomingSource: sourceConfig,
        existingDestinationUrl: existingGitea?.url,
        incomingDestinationUrl: giteaConfig.url,
        confirmSourceChange: confirmSourceChange === true,
        confirmDestinationChange: confirmDestinationChange === true,
      });
      if (!verdict.ok) {
        return new Response(
          JSON.stringify({ success: false, message: verdict.message, lock: verdict.lock }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Map UI structure to database schema structure first
    const { sourceConfig: mappedSourceConfig, giteaConfig: mappedGiteaConfig } = mapUiToDbConfig(
      sourceConfig,
      giteaConfig,
      mirrorOptions,
      advancedOptions,
      { sourceConfig: existingSource, giteaConfig: existingGitea }
    );

    // Preserve tokens if fields are empty
    try {
      // Decrypt existing tokens before preserving
      if (!mappedSourceConfig.token && existingSource?.token) {
        mappedSourceConfig.token = decrypt(existingSource.token);
      }

      if (!mappedGiteaConfig.token && existingGitea?.token) {
        mappedGiteaConfig.token = decrypt(existingGitea.token);
      }
    } catch (tokenError) {
      console.error("Failed to preserve tokens:", tokenError);
    }

    // Encrypt tokens before saving
    if (mappedSourceConfig.token) {
      mappedSourceConfig.token = encrypt(mappedSourceConfig.token);
    }

    if (mappedGiteaConfig.token) {
      mappedGiteaConfig.token = encrypt(mappedGiteaConfig.token);
    }

    // Map schedule and cleanup configs to database schema
    const processedScheduleConfig = mapUiScheduleToDb(
      scheduleConfig,
      existingConfig ? existingConfig.scheduleConfig : undefined
    );
    const processedCleanupConfig = mapUiCleanupToDb(cleanupConfig);

    // Process notification config if provided
    let processedNotificationConfig: any = undefined;
    if (validatedNotificationConfig) {
      processedNotificationConfig = { ...validatedNotificationConfig };
      // Encrypt ntfy token if present
      if (processedNotificationConfig.ntfy?.token) {
        processedNotificationConfig.ntfy = {
          ...processedNotificationConfig.ntfy,
          token: encrypt(processedNotificationConfig.ntfy.token),
        };
      }
      // Encrypt apprise token if present
      if (processedNotificationConfig.apprise?.token) {
        processedNotificationConfig.apprise = {
          ...processedNotificationConfig.apprise,
          token: encrypt(processedNotificationConfig.apprise.token),
        };
      }
      // Encrypt gotify token if present
      if (processedNotificationConfig.gotify?.token) {
        processedNotificationConfig.gotify = {
          ...processedNotificationConfig.gotify,
          token: encrypt(processedNotificationConfig.gotify.token),
        };
      }
      // Encrypt webhook secret if present
      if (processedNotificationConfig.webhook?.secret) {
        processedNotificationConfig.webhook = {
          ...processedNotificationConfig.webhook,
          secret: encrypt(processedNotificationConfig.webhook.secret),
        };
      }
    }

    if (existingConfig) {
      // Update path
      const updateFields: Record<string, any> = {
        sourceConfig: mappedSourceConfig,
        giteaConfig: mappedGiteaConfig,
        scheduleConfig: processedScheduleConfig,
        cleanupConfig: processedCleanupConfig,
        updatedAt: new Date(),
      };
      if (processedNotificationConfig) {
        updateFields.notificationConfig = processedNotificationConfig;
      }
      await db
        .update(configs)
        .set(updateFields)
        .where(eq(configs.id, existingConfig.id));

      return new Response(
        JSON.stringify({
          success: true,
          message: "Configuration updated successfully",
          configId: existingConfig.id,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Fallback user check (optional if you're always passing userId)
    const userExists = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (userExists.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Invalid userId. No matching user found.",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Create new config
    const configId = uuidv4();
    const insertValues: Record<string, any> = {
      id: configId,
      userId,
      name: "Default Configuration",
      isActive: true,
      sourceConfig: mappedSourceConfig,
      giteaConfig: mappedGiteaConfig,
      include: [],
      exclude: [],
      scheduleConfig: processedScheduleConfig,
      cleanupConfig: processedCleanupConfig,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (processedNotificationConfig) {
      insertValues.notificationConfig = processedNotificationConfig;
    }
    await db.insert(configs).values(insertValues);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Configuration created successfully",
        configId,
      }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return createSecureErrorResponse(error, "config save", 500);
  }
};

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const authResult = await requireAuthenticatedUserId({ request, locals });
    if ("response" in authResult) return authResult.response;
    const userId = authResult.userId;

    // Fetch the configuration for the user — prefer the active config; fall back to
    // most-recently-updated so a stale inactive stub never wins over a populated
    // active row (see issue #271).
    const config = await db
      .select()
      .from(configs)
      .where(eq(configs.userId, userId))
      .orderBy(sql`${configs.isActive} DESC`, sql`${configs.updatedAt} DESC`)
      .limit(1);

    const locks = await loadConfigLocks(userId);

    // Sources for the Sources card: per-source repository counts, lock state
    // and decrypted tokens, following the same convention as the config
    // tokens below. A failure must not take the Configuration page down.
    let sources: SourceApiItem[] = [];
    try {
      // Heal configs written outside the sources API (scripts, seeds):
      // seed the first source row before listing.
      const { ensureSourcesFromConfig } = await import("@/lib/sources");
      await ensureSourcesFromConfig(userId);
      sources = await loadSourceApiItems(userId);
    } catch (sourcesError) {
      console.warn(
        `[Config] Could not load sources for user ${userId}: ${
          sourcesError instanceof Error ? sourcesError.message : String(sourcesError)
        }`
      );
    }

    if (config.length === 0) {
      // Create default configuration for the user
      const defaultConfig = await createDefaultConfig({ userId });

      // Map the created config to UI format
      const uiConfig = mapDbToUiConfig(defaultConfig);
      const uiScheduleConfig = mapDbScheduleToUi(defaultConfig.scheduleConfig);
      const uiCleanupConfig = mapDbCleanupToUi(defaultConfig.cleanupConfig);

      return new Response(
        JSON.stringify({
          ...defaultConfig,
          ...uiConfig,
          scheduleConfig: uiScheduleConfig,
          cleanupConfig: uiCleanupConfig,
          locks,
          sources,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Map database structure to UI structure
    const dbConfig = config[0];

    // Decrypt tokens before sending to UI
    try {
      const sourceConfig = typeof dbConfig.sourceConfig === "string"
        ? JSON.parse(dbConfig.sourceConfig)
        : dbConfig.sourceConfig;

      const giteaConfig = typeof dbConfig.giteaConfig === "string"
        ? JSON.parse(dbConfig.giteaConfig)
        : dbConfig.giteaConfig;

      // Decrypt tokens
      if (sourceConfig.token) {
        sourceConfig.token = decrypt(sourceConfig.token);
      }

      if (giteaConfig.token) {
        giteaConfig.token = decrypt(giteaConfig.token);
      }

      // Create modified config with decrypted tokens
      const decryptedConfig = {
        ...dbConfig,
        sourceConfig,
        giteaConfig
      };

      const uiConfig = mapDbToUiConfig(decryptedConfig);

      // Map schedule and cleanup configs to UI format
      const uiScheduleConfig = mapDbScheduleToUi(dbConfig.scheduleConfig);
      const uiCleanupConfig = mapDbCleanupToUi(dbConfig.cleanupConfig);

      // Decrypt notification config tokens
      let notificationConfig = dbConfig.notificationConfig;
      if (notificationConfig) {
        notificationConfig = { ...notificationConfig };
        if (notificationConfig.ntfy?.token) {
          try {
            notificationConfig.ntfy = { ...notificationConfig.ntfy, token: decrypt(notificationConfig.ntfy.token) };
          } catch {
            // Clear token on decryption failure to prevent double-encryption on next save
            notificationConfig.ntfy = { ...notificationConfig.ntfy, token: "" };
          }
        }
        if (notificationConfig.apprise?.token) {
          try {
            notificationConfig.apprise = { ...notificationConfig.apprise, token: decrypt(notificationConfig.apprise.token) };
          } catch {
            notificationConfig.apprise = { ...notificationConfig.apprise, token: "" };
          }
        }
        if (notificationConfig.gotify?.token) {
          try {
            notificationConfig.gotify = { ...notificationConfig.gotify, token: decrypt(notificationConfig.gotify.token) };
          } catch {
            notificationConfig.gotify = { ...notificationConfig.gotify, token: "" };
          }
        }
        if (notificationConfig.webhook?.secret) {
          try {
            notificationConfig.webhook = { ...notificationConfig.webhook, secret: decrypt(notificationConfig.webhook.secret) };
          } catch {
            notificationConfig.webhook = { ...notificationConfig.webhook, secret: "" };
          }
        }
      }

      return new Response(JSON.stringify({
        ...dbConfig,
        ...uiConfig,
        scheduleConfig: {
          ...uiScheduleConfig,
          lastRun: dbConfig.scheduleConfig.lastRun,
          nextRun: dbConfig.scheduleConfig.nextRun,
        },
        cleanupConfig: {
          ...uiCleanupConfig,
          lastRun: dbConfig.cleanupConfig.lastRun,
          nextRun: dbConfig.cleanupConfig.nextRun,
        },
        notificationConfig,
        locks,
        sources,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Failed to decrypt tokens:", error);
      // Return config without decrypting tokens if there's an error
      const uiConfig = mapDbToUiConfig(dbConfig);
      const uiScheduleConfig = mapDbScheduleToUi(dbConfig.scheduleConfig);
      const uiCleanupConfig = mapDbCleanupToUi(dbConfig.cleanupConfig);

      return new Response(JSON.stringify({
        ...dbConfig,
        ...uiConfig,
        scheduleConfig: {
          ...uiScheduleConfig,
          lastRun: dbConfig.scheduleConfig.lastRun,
          nextRun: dbConfig.scheduleConfig.nextRun,
        },
        cleanupConfig: {
          ...uiCleanupConfig,
          lastRun: dbConfig.cleanupConfig.lastRun,
          nextRun: dbConfig.cleanupConfig.nextRun,
        },
        notificationConfig: dbConfig.notificationConfig,
        locks,
        sources,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    return createSecureErrorResponse(error, "config fetch", 500);
  }
};
