import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createTwoFilesPatch } from "diff";
import { Capture, type TurnStart, type TurnEnd } from "../server/capture";
import { Store } from "../server/store";

test("本轮固定使用开始时的配置，Codex 原生数据缺失不切换来源", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-capture-"));
  try {
    const store = new Store(path.join(cwd, "state"));
    const capture = new Capture(store);
    const originalConfig = await store.readSettings();
    await store.saveSettings(originalConfig.revision, {
      ...originalConfig.values,
      providers: { codex: "native" },
    });
    const start: TurnStart = {
      agent: {
        id: "codex-agent",
        workspaceId: "workspace",
        parentAgentId: null,
        provider: "codex",
        cwd,
        title: "test",
      },
      turnId: "turn-1",
    };
    await capture.start(start);
    const config = await store.readSettings();
    await store.saveSettings(config.revision, { ...config.values, providers: { codex: "edits" } });
    await writeFile(path.join(cwd, "file"), "new\n");
    const patch = createTwoFilesPatch("file", "file", "old\n", "new\n");
    const edit = {
      type: "tool_call",
      status: "completed",
      detail: { type: "edit", filePath: "file", unifiedDiff: patch },
    };
    const first = await capture.finish({ ...start, outcome: { kind: "completed" }, timeline: [] }, [
      edit,
    ]);
    assert.equal(first.source, "native");
    assert.equal(first.canUndo, false);
    assert.match(first.issues[0], /未转发/);
    const second: TurnStart = { ...start, turnId: "turn-2" };
    await capture.start(second);
    const result = await capture.finish(
      { ...second, outcome: { kind: "completed" }, timeline: [] },
      [edit],
    );
    assert.equal(result.source, "edits");
    assert.equal(result.files[0].before?.text, "old\n");
    assert.equal(result.canUndo, true);
    assert.equal((await store.get(first.id, "codex-agent")).source, "native");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("失败轮次也保存原生差异；插件重载后读取原始记录", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-capture-"));
  try {
    const store = new Store(path.join(cwd, "state"));
    const capture = new Capture(store);
    const event: TurnEnd = {
      agent: {
        id: "agent",
        workspaceId: null,
        parentAgentId: null,
        provider: "codex",
        cwd,
        title: null,
      },
      turnId: "turn",
      outcome: { kind: "failed", error: { message: "provider failed" } },
      timeline: [],
      nativeDiff: createTwoFilesPatch("file", "file", "old\n", "new\n"),
    };
    await capture.start(event);
    await writeFile(path.join(cwd, "file"), "new\n");
    const record = await capture.finish(event, []);
    assert.equal(record.outcome, "failed");
    assert.equal(record.files[0].additions, 1);
    assert.deepEqual(await new Store(store.directory).get(record.id, "agent"), record);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("未提供原生接口时，即使没有编辑条目也明确提示，并保留失败状态", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-capture-"));
  try {
    const store = new Store(path.join(cwd, "state"));
    const capture = new Capture(store);
    const config = await store.readSettings();
    await store.saveSettings(config.revision, { ...config.values, providers: { codex: "native" } });
    const event: TurnEnd = {
      agent: {
        id: "agent",
        workspaceId: null,
        parentAgentId: null,
        provider: "codex",
        cwd,
        title: null,
      },
      turnId: "turn",
      outcome: { kind: "failed", error: { message: "failed" } },
      timeline: [],
    };
    await capture.start(event);
    const record = await capture.finish(event, []);
    assert.match(record.issues[0], /未转发/);
    assert.equal(record.outcome, "failed");
    assert.equal(record.canUndo, false);
    assert.equal((await new Store(store.directory).nativeStatus()).codex.available, false);
    await capture.start({ ...event, turnId: "next" });
    const empty = await capture.finish(
      { ...event, turnId: "next", nativeDiff: null, outcome: { kind: "completed" } },
      [],
    );
    assert.deepEqual(empty.issues, []);
    assert.equal((await store.nativeStatus()).codex.available, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("自动模式按本轮信号选择来源，保留固定配置和历史来源", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-auto-"));
  try {
    const store = new Store(path.join(cwd, "state"));
    const capture = new Capture(store);
    const event: TurnEnd = {
      agent: {
        id: "auto-agent",
        workspaceId: null,
        parentAgentId: null,
        provider: "codex",
        cwd,
        title: null,
      },
      turnId: "without-patch",
      outcome: { kind: "completed" },
      timeline: [],
    };
    const patch = createTwoFilesPatch("file", "file", "old\n", "new\n");
    const edit = {
      type: "tool_call",
      status: "completed",
      detail: { type: "edit", filePath: "file", unifiedDiff: patch },
    };
    await writeFile(path.join(cwd, "file"), "new\n");
    await capture.start(event);
    const fallback = await capture.finish(event, [edit]);
    assert.equal(fallback.requestedSource, "auto");
    assert.equal(fallback.source, "edits");
    assert.deepEqual(fallback.issues, []);
    assert.equal(fallback.canUndo, true);
    assert.equal(fallback.files[0].before?.text, "old\n");

    const withPatch = { ...event, turnId: "with-patch", nativeDiff: patch };
    await capture.start(withPatch);
    const config = await store.readSettings();
    await store.saveSettings(config.revision, { ...config.values, providers: { codex: "edits" } });
    const native = await capture.finish(withPatch, []);
    assert.equal(native.source, "native");
    assert.equal(native.requestedSource, "auto");
    assert.equal(native.canUndo, true);
    assert.equal(native.files.length, 1);
    const forced = { ...withPatch, turnId: "forced-edits" };
    await capture.start(forced);
    assert.equal((await capture.finish(forced, [edit])).source, "edits");
    assert.equal((await store.get(fallback.id, event.agent.id)).source, "edits");

    const current = await store.readSettings();
    await store.saveSettings(current.revision, { ...current.values, providers: { codex: "auto" } });
    for (const [turnId, signal] of [
      ["empty-diff", ""],
      ["no-changes", null],
    ] as const) {
      const empty = { ...event, turnId, nativeDiff: signal };
      await capture.start(empty);
      const result = await capture.finish(empty, []);
      assert.equal(result.source, "native");
      assert.deepEqual(result.files, []);
      assert.deepEqual(result.issues, []);
    }
    const noSignal = { ...event, turnId: "no-signal-again" };
    await capture.start(noSignal);
    const result = await capture.finish(noSignal, []);
    assert.equal(result.source, "edits");
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.files, []);

    const incomplete = { ...event, turnId: "incomplete" };
    await capture.start(incomplete);
    const failed = await capture.finish(incomplete, [edit], "历史分页不完整");
    assert.equal(failed.canUndo, false);
    assert.deepEqual(failed.issues, ["历史分页不完整"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("重载后恢复持久化的开始记录，缺少开始记录时仍禁止撤销", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-capture-"));
  try {
    const store = new Store(path.join(cwd, "state"));
    const event: TurnEnd = {
      agent: {
        id: "agent",
        workspaceId: null,
        parentAgentId: null,
        provider: "codex",
        cwd,
        title: null,
      },
      turnId: "turn",
      outcome: { kind: "completed" },
      timeline: [],
      nativeDiff: createTwoFilesPatch("file", "file", "old\n", "new\n"),
    };
    await writeFile(path.join(cwd, "file"), "new\n");
    await new Capture(store).start(event);
    const original = (await store.list("agent"))[0];
    const settings = await store.readSettings();
    await store.saveSettings(settings.revision, {
      ...settings.values,
      providers: { codex: "edits" },
    });
    const result = await new Capture(store).finish(event, []);
    assert.equal(result.id, original.id);
    assert.equal(result.source, "native");
    assert.equal(result.canUndo, true);
    assert.deepEqual(result.issues, []);
    assert.equal((await store.list("agent")).length, 1);
    const missing = await new Capture(store).finish({ ...event, turnId: "missing" }, []);
    assert.equal(missing.canUndo, false);
    assert.match(missing.issues[0], /缺少本轮开始记录/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
