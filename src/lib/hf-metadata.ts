import { currentGitSignal } from "./push-engine/git";
import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { Config, Repository } from "./db/schema";
import { HuggingFaceSourceProvider, hfApiPath, type HFRepository } from "./source-providers/huggingface";
import { findSourceForRepository, type SourceRecord } from "./sources";
import { sourceConnectionFromSource } from "./source-providers";
import { GiteaPushTarget } from "./push-engine/targets/gitea";
import { resolveDestinationConnection } from "./destination-connection";
import type { ResolvedMirrorOptions } from "./utils/mirror-overrides";
import { withCloneLock } from "./push-engine/lock";

interface HFEvent {
  id: string; type: string; createdAt: string; author?: { name?: string };
  data?: { hidden?: boolean; latest?: { raw?: string } };
}
interface HFDiscussion {
  num: number; title: string; status: string; isPullRequest: boolean;
  author?: { name?: string }; createdAt: string; events?: HFEvent[];
}
interface GiteaIssue { number: number; body?: string; title?: string; state?: string }
interface GiteaComment { id: number; body?: string }

export function discussionMarker(repository: Pick<Repository, "repoType" | "fullName">, num: number) {
  return `<!-- hf-mirror:${repository.repoType}:${repository.fullName}:${num} -->`;
}
export function eventBody(event: HFEvent) {
  return `<!-- hf-event:${event.id} -->\n**${event.author?.name ?? "deleted"}** · ${event.createdAt}\n\n${event.data?.hidden ? "[Comment hidden on Hugging Face]" : event.data?.latest?.raw ?? ""}`;
}

export async function archiveHFMetadata(input: {
  config: Partial<Config>; repository: Repository; sources: SourceRecord[];
  owner: string; name: string; archiveDirectory: string; options: ResolvedMirrorOptions; log?: (message: string) => void;
}) {
  const { config, repository, sources, owner, name, archiveDirectory, options } = input;
  const row = findSourceForRepository(repository, sources);
  if (!row) throw new Error("HF source connection is missing");
  const provider = new HuggingFaceSourceProvider(sourceConnectionFromSource(row), currentGitSignal(), input.log);
  const api = hfApiPath(repository.repoType, repository.fullName);
  const target = new GiteaPushTarget(resolveDestinationConnection(config));
  const route = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`;
  await mkdir(archiveDirectory, { recursive: true });
  await withCloneLock(path.join(archiveDirectory, "metadata"), async () => {
    const { data: metadata } = await provider.request<HFRepository>(api);
    if (config.giteaConfig?.addTopics !== false && metadata.tags?.length) {
      const prefix = config.giteaConfig?.topicPrefix ?? "hf";
      const topics = [...new Set([`${prefix}-${repository.repoType}`, ...metadata.tags].map(tag =>
        tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 25)).filter(Boolean))].slice(0, 20);
      await target.api(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/topics`, "PUT", { topics });
    }
    const collections = [];
    for (const slug of config.sourceConfig?.collections ?? []) collections.push(await provider.getCollection(slug));
    const discussions: HFDiscussion[] = [];
    const wantsDiscussions = options.mirrorIssues || options.mirrorPullRequests;
    if (wantsDiscussions) {
      for (let p = 0; ; p++) {
        if (p >= 10_000) throw new Error("HF discussion pagination is incomplete");
        const { data } = await provider.request<{ count: number; start: number; discussions: HFDiscussion[] }>(`${api}/discussions?p=${p}`);
        for (const item of data.discussions) {
          if (item.isPullRequest ? !options.mirrorPullRequests : !options.mirrorIssues) continue;
          discussions.push((await provider.request<HFDiscussion>(`${api}/discussions/${item.num}`)).data);
        }
        if (data.start + data.discussions.length >= data.count) break;
        if (!data.discussions.length) throw new Error("HF discussion pagination stopped before completion");
      }
    }
    // Archive first: a destination metadata failure must not discard what was downloaded.
    const archive = { version: 1, source: repository.url, repoType: repository.repoType,
      archivedAt: new Date().toISOString(), metadata, collections, discussions };
    const filename = `metadata-${Date.now()}.json`;
    await writeFile(path.join(archiveDirectory, filename), JSON.stringify(archive, null, 2));
    await writeFile(path.join(archiveDirectory, "latest.tmp"), JSON.stringify(archive, null, 2));
    await rename(path.join(archiveDirectory, "latest.tmp"), path.join(archiveDirectory, "latest.json"));
    if (!wantsDiscussions) return;
    const existing = await listGitea<GiteaIssue>(target, `${route}?state=all&type=issues`);
    for (const discussion of discussions) {
      const marker = discussionMarker(repository, discussion.num);
      const body = `${marker}\n[Original ${discussion.isPullRequest ? "pull request" : "discussion"}](${repository.url}/discussions/${discussion.num})\n\n` +
        `**${discussion.author?.name ?? "deleted"}** · ${discussion.createdAt}\nHF status: ${discussion.status}`;
      const title = `${discussion.isPullRequest ? "[HF PR]" : "[HF Discussion]"} ${discussion.title}`;
      const state = ["closed", "merged"].includes(discussion.status) ? "closed" : "open";
      let issue = existing.find(i => i.body?.includes(marker));
      if (!issue) {
        issue = await target.api<GiteaIssue>(route, "POST", { title, body });
        existing.push(issue);
      }
      if (issue.body !== body || issue.title !== title || issue.state !== state) {
        await target.api(`${route}/${issue.number}`, "PATCH", { title, body, state });
      }
      const comments = await listGitea<GiteaComment>(target, `${route}/${issue.number}/comments?`);
      for (const event of discussion.events ?? []) {
        if (event.type !== "comment") continue;
        const commentBody = eventBody(event);
        const previous = comments.find(c => c.body?.includes(`<!-- hf-event:${event.id} -->`));
        if (previous) {
          if (previous.body !== commentBody) await target.api(`${route}/comments/${previous.id}`, "PATCH", { body: commentBody });
        } else {
          const created = await target.api<GiteaComment>(`${route}/${issue.number}/comments`, "POST", { body: commentBody });
          comments.push(created);
        }
      }
    }
  });
}

async function listGitea<T>(target: GiteaPushTarget, route: string): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; page <= 10_000; page++) {
    const rows = await target.api<T[]>(`${route}&limit=50&page=${page}`);
    if (!Array.isArray(rows)) throw new Error("Unexpected Gitea metadata response");
    result.push(...rows);
    if (rows.length < 50) return result;
  }
  throw new Error("Gitea metadata pagination is incomplete");
}
