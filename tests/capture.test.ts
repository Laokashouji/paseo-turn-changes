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

test("中途重载保留开始时的数据来源，但不开放不完整轮次的撤销", async () => {
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
      nativeDiff: "",
    };
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
    assert.equal(result.canUndo, false);
    assert.equal((await store.list("agent")).length, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
