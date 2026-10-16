// A deterministic HF API + real Git smart HTTP + LFS source. No app mocks.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = "/fixture";
const weights = Buffer.from("HF historical weights\n".repeat(8192));
const oid = createHash("sha256").update(weights).digest("hex");
const prWeights = Buffer.from("HF PR-only weights\n".repeat(4096));
const prOid = createHash("sha256").update(prWeights).digest("hex");
const objects = new Map([[oid, weights], [prOid, prWeights]]);
let revision = 1;
let offline = false;
let missing = false;
let denied = 0;
async function git(args: string[]) {
  const p = Bun.spawn(["git", ...args], { env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1", GIT_CONFIG_NOSYSTEM: "1" }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code) throw new Error(`git ${args.join(" ")}: ${err}`);
  return out.trim();
}
for (const prefix of ["", "datasets/", "spaces/"]) {
  const work = `${root}/${prefix}alice/tiny`;
  await mkdir(work, { recursive: true });
  await git(["init", "-b", "main", work]);
  await git(["-C", work, "config", "user.name", "HF fixture"]);
  await git(["-C", work, "config", "user.email", "hf@example.test"]);
  await writeFile(`${work}/README.md`, "# Model card v1\n");
  // Intentionally commit the pointer without a local filter. The HTTP LFS API serves the bytes.
  await writeFile(`${work}/weights.bin`, `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${weights.length}\n`);
  await git(["-C", work, "add", "."]);
  await git(["-C", work, "commit", "-m", "historical weights"]);
  await git(["-C", work, "tag", "v1"]);
  await git(["-C", work, "rm", "weights.bin"]);
  await git(["-C", work, "commit", "-m", "remove weights from HEAD"]);
  await git(["-C", work, "branch", "extra"]);
  await git(["-C", work, "checkout", "-b", "pr-weights"]);
  await writeFile(`${work}/pr.bin`, `version https://git-lfs.github.com/spec/v1\noid sha256:${prOid}\nsize ${prWeights.length}\n`);
  await git(["-C", work, "add", "pr.bin"]);
  await git(["-C", work, "commit", "-m", "PR-only weights"]);
  await git(["-C", work, "update-ref", "refs/pr/7", "HEAD"]);
  await git(["-C", work, "checkout", "main"]);
  await git(["-C", work, "branch", "-D", "pr-weights"]);
  await git(["clone", "--bare", work, `${work}.git`]);
  // --bare omits PR refs; copy explicitly like HF's advertised refs.
  await git(["-C", work, "push", `${work}.git`, "refs/pr/7"]);
}
const work = `${root}/alice/tiny`;
const state = async () => ({ revision, oid, size: weights.length, prOid, prSize: prWeights.length, sha: await git(["-C", work, "rev-parse", "HEAD"]), denied });
const metadata = (type: string) => ({ id: "alice/tiny", private: type === "spaces", gated: type === "datasets" ? "auto" : false,
  tags: ["pytorch", "test-model"], description: "Container E2E fixture", createdAt: "2025-01-01T00:00:00Z", lastModified: new Date().toISOString(), siblings: [{ rfilename: "weights.bin", lfs: { oid, size: weights.length } }] });
const server = Bun.serve({ hostname: "0.0.0.0", port: 8080, async fetch(request) {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/__test/state") return Response.json(await state());
    if (url.pathname === "/__test/offline" && request.method === "POST") { offline = true; return Response.json({ ok: true }); }
    if (["/__test/advance", "/__test/rewrite", "/__test/missing"].includes(url.pathname) && request.method === "POST") {
      revision++;
      missing = url.pathname.endsWith("missing");
      await writeFile(`${work}/README.md`, `# Model card v${revision}\n`);
      if (missing) await writeFile(`${work}/missing.bin`, `version https://git-lfs.github.com/spec/v1\noid sha256:${"f".repeat(64)}\nsize 10\n`);
      await git(["-C", work, "add", "."]);
      await git(["-C", work, "commit", ...(url.pathname.endsWith("rewrite") ? ["--amend"] : []), "-m", `revision ${revision}`]);
      await git(["-C", work, "push", "--force", `${work}.git`, "main"]);
      if (url.pathname.endsWith("advance")) {
        await git(["-C", `${work}.git`, "update-ref", "refs/tags/v2", "refs/heads/main"]);
      }
      if (url.pathname.endsWith("rewrite")) await git(["-C", `${work}.git`, "update-ref", "-d", "refs/heads/extra"]);
      return Response.json(await state());
    }
    if (url.pathname === "/__test/restore" && request.method === "POST") {
      const { cloneUrl, token, expectedOid = oid } = await request.json() as any;
      const auth = `http.extraHeader=Authorization: Basic ${Buffer.from(`e2e_admin:${token}`).toString("base64")}`;
      const destination = `${root}/restore-${Date.now()}.git`;
      await git(["-c", auth, "clone", "--mirror", cloneUrl, destination]);
      await git(["-c", auth, "-c", `lfs.url=${cloneUrl}/info/lfs`, "-C", destination, "lfs", "fetch", "--all", "origin"]);
      const bytes = await readFile(`${destination}/lfs/objects/${expectedOid.slice(0, 2)}/${expectedOid.slice(2, 4)}/${expectedOid}`);
      if (createHash("sha256").update(bytes).digest("hex") !== expectedOid) throw new Error("Restored weights differ");
      const refs = await git(["-C", destination, "ls-remote", "origin"]);
      if (expectedOid === oid && !refs.includes("refs/hf-mirror/pr/7")) throw new Error("PR ref was not backed up");
      if (expectedOid === oid) {
        const prBytes = await readFile(`${destination}/lfs/objects/${prOid.slice(0, 2)}/${prOid.slice(2, 4)}/${prOid}`);
        if (!prBytes.equals(prWeights)) throw new Error("PR-only weights were not restored");
      }
      return Response.json({ oid: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, prOid, denied });
    }
    if (offline) { denied++; return new Response("Source offline", { status: 503 }); }
    if (url.pathname === "/api/whoami-v2") return Response.json({ name: "alice", orgs: [] });
    const api = url.pathname.match(/^\/api\/(models|datasets|spaces)\/alice\/tiny(.*)$/);
    if (api) {
      const discussion = (num: number) => ({ num, title: `Conversation ${num} revision ${revision}`, status: revision > 1 ? "closed" : "open", isPullRequest: num === 7,
        author: { name: "alice" }, createdAt: "2025-01-01T00:00:00Z", events: [{ id: `comment-${num}`, type: "comment", author: { name: "alice" }, createdAt: "2025-01-01T00:00:00Z", data: { latest: { raw: `Comment revision ${revision}` } } }] });
      if (api[2] === "/discussions") return Response.json({ count: 2, start: 0, discussions: [discussion(1), discussion(7)] });
      if (api[2].startsWith("/discussions/")) return Response.json(discussion(Number(api[2].split("/").at(-1))));
      return Response.json(metadata(api[1]));
    }
    if (/^\/api\/(models|datasets|spaces)$/.test(url.pathname)) return Response.json([metadata(url.pathname.split("/").at(-1)!)]);
    if (url.pathname.endsWith("/info/lfs/objects/batch")) {
      const body = await request.json() as any;
      return Response.json({ transfer: "basic", objects: body.objects.map((o: any) => objects.has(o.oid) ? { ...o, actions: { download: { href: `http://source:8080/objects/${o.oid}` } } } : { ...o, error: { code: 404, message: "Missing fixture object" } }) });
    }
    if (url.pathname.startsWith("/objects/") && objects.has(url.pathname.slice(9))) return new Response(objects.get(url.pathname.slice(9))!);
    const p = Bun.spawn(["git", "http-backend"], { env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: url.pathname,
      REQUEST_METHOD: request.method, QUERY_STRING: url.search.slice(1), CONTENT_TYPE: request.headers.get("content-type") ?? "", SERVER_PROTOCOL: "HTTP/1.1", REMOTE_ADDR: "127.0.0.1" }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    p.stdin.write(new Uint8Array(await request.arrayBuffer())); p.stdin.end();
    const [output, error, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text(), p.exited]);
    if (code) return new Response(error, { status: 500 });
    const bytes = Buffer.from(output); const split = bytes.indexOf("\r\n\r\n");
    const headers = new Headers(); let status = 200;
    for (const line of bytes.subarray(0, split).toString().split("\r\n")) {
      const colon = line.indexOf(":"); if (colon < 0) continue;
      if (line.slice(0, colon).toLowerCase() === "status") status = Number(line.slice(colon + 1).trim().split(" ")[0]);
      else headers.set(line.slice(0, colon), line.slice(colon + 1).trim());
    }
    return new Response(bytes.subarray(split + 4), { status, headers });
  } catch (error) { console.error(error); return new Response(String(error), { status: 500 }); }
} });
console.log(`HF fixture ready on ${server.port}`);
