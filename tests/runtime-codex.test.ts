import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { contribute } from "../server/runtime";
import { recordSchema, Store } from "../server/store";
import { getSummary, getFile, getSource, saveSource } from "../shared/contracts";

test("自定义 Codex 后端在历史审核、源文件读写及新轮次中使用同一日志和文件索引", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "turn-provider-"));
  const originalHome = process.env.PASEO_TURN_CHANGES_HOME;
  process.env.PASEO_TURN_CHANGES_HOME = path.join(root, "records");
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const cwd = path.join(root, "workspace");
    const codexHome = path.join(root, "provider-home");
    await mkdir(cwd);
    await mkdir(path.join(codexHome, "sessions"), { recursive: true });
    const sessionId = randomUUID();
    const logPath = path.join(codexHome, "sessions", `rollout-${sessionId}.jsonl`);
    const first = path.join(cwd, "first.txt");
    const extra = path.join(root, "extra.txt");
    await writeFile(first, "first\n");
    await writeFile(extra, "extra\nline\n");
    const agent = {
      id: "test-agent",
      provider: "custom-model",
      cwd,
      title: null,
      workspaceId: null,
      parentAgentId: null,
      persistence: { sessionId },
    };
    let turnId = "turn-1";
    let seq = 10;
    const call = {
      type: "tool_call",
      status: "completed",
      callId: "edit-1",
      detail: { type: "edit", filePath: first, newString: "first\n" },
    };
    const nativeEvent = {
      type: "event_msg",
      payload: {
        type: "item_completed",
        thread_id: sessionId,
        item: {
          type: "FileChange",
          id: call.callId,
          status: "completed",
          changes: {
            [extra]: { type: "add", content: "extra\nline\n" },
            [first]: { type: "add", content: "first\n" },
          },
        },
      },
    };
    await writeFile(
      logPath,
      [{ type: "session_meta", payload: { id: sessionId } }, nativeEvent]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    const store = new Store(process.env.PASEO_TURN_CHANGES_HOME);
    const record = recordSchema.parse({
      version: 1,
      id: randomUUID(),
      agentId: agent.id,
      provider: agent.provider,
      cwd,
      turnId,
      source: "edits",
      requestedSource: "auto",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      timeline: { epoch: "epoch", maxSeq: seq },
      outcome: "completed",
      issues: [],
      canUndo: false,
      undoneAt: null,
      files: [
        {
          path: "first.txt",
          previousPath: null,
          additions: null,
          deletions: null,
          patch: "",
          content: "first\n",
          before: null,
          after: null,
          issue: "缺少旧内容",
        },
      ],
    });
    await store.save(record);
    const savedPath = path.join(store.directory, "records", `${record.id}.json`);
    const saved = await readFile(savedPath, "utf8");
    const appended: unknown[] = [];
    let epoch = "epoch";
    const paseo = {
      config: {
        get: async () => ({
          config: {
            providers: {
              "custom-model": { extends: "custom-base" },
              "custom-base": { extends: "codex", env: { CODEX_HOME: codexHome } },
            },
          },
        }),
      },
      agents: {
        ref: () => ({
          refresh: async () => ({ agent }),
          timeline: {
            refetch: async () => ({
              epoch,
              hasOlder: false,
              entries: [{ turnId, seqEnd: seq, item: call }],
            }),
            append: async (item: unknown) => {
              appended.push(item);
            },
          },
        }),
      },
    };
    type Handler = (input: unknown, context: { paseo: typeof paseo }) => Promise<unknown>;
    const handlers = new Map<string, Handler>();
    const hooks = new Map<string, Handler>();
    cleanup = contribute({
      handle: (rpc: { name: string }, handler: Handler) => handlers.set(rpc.name, handler),
      on: (name: string, handler: Handler) => hooks.set(name, handler),
    } as unknown as PluginServerContext);
    const invoke = (name: string, input: unknown) => handlers.get(name)!(input, { paseo });
    const input = { agentId: agent.id, recordId: record.id };
    const shown = getSummary.output.parse(await invoke(getSummary.name, input));
    assert.deepEqual(
      shown.files.map((file) => [file.path, file.additions, file.deletions]),
      [
        ["first.txt", 1, 0],
        ["../extra.txt", 2, 0],
      ],
    );
    assert.equal(shown.canUndo, false);
    const selected = { ...input, index: 1 };
    const diff = getFile.output.parse(await invoke(getFile.name, selected));
    assert.match(diff.patch, /\+extra\n\+line/);
    const source = getSource.output.parse(await invoke(getSource.name, selected));
    assert.equal(source.content, "extra\nline\n");
    await invoke(saveSource.name, {
      ...selected,
      absolutePath: source.absolutePath,
      revision: source.revision,
      content: "edited extra\n",
    });
    assert.equal(await readFile(extra, "utf8"), "edited extra\n");
    assert.equal(await readFile(first, "utf8"), "first\n");
    assert.equal(await readFile(savedPath, "utf8"), saved);
    epoch = "replacement";
    const replaced = getSummary.output.parse(await invoke(getSummary.name, input));
    assert.equal(replaced.files.length, 1);
    assert.equal(replaced.files[0].additions, null);
    epoch = "epoch";
    turnId = "turn-2";
    seq = 20;
    await hooks.get("agent.turn_started")!({ agent, turnId }, { paseo });
    await hooks.get("agent.turn_ended")!(
      { agent, turnId, timeline: [], outcome: { kind: "completed" } },
      { paseo },
    );
    const next = (await store.list(agent.id)).find((value) => value.turnId === turnId)!;
    assert.ok(next);
    assert.equal(next.files.length, 2);
    const nextShown = getSummary.output.parse(
      await invoke(getSummary.name, { ...input, recordId: next.id }),
    );
    assert.equal(
      nextShown.files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
      3,
    );
    assert.equal(appended.length, 1);
    await rm(logPath);
    turnId = record.turnId!;
    seq = 10;
    const unavailable = getSummary.output.parse(await invoke(getSummary.name, input));
    assert.equal(unavailable.files.length, 1);
    assert.equal(unavailable.files[0].additions, null);
  } finally {
    await cleanup?.();
    if (originalHome === undefined) delete process.env.PASEO_TURN_CHANGES_HOME;
    else process.env.PASEO_TURN_CHANGES_HOME = originalHome;
    await rm(root, { recursive: true, force: true });
  }
});
