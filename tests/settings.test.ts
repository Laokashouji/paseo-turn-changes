import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { settingsSchema, sourceFor } from "../shared/contracts";
import { Store } from "../server/store";

test("Codex 自动选择差异来源，其他后端汇总编辑；显式配置覆盖默认值", () => {
  const defaults = settingsSchema.parse({});
  assert.equal(sourceFor(defaults, "codex"), "auto");
  assert.equal(sourceFor(defaults, "claude"), "edits");
  assert.equal(sourceFor(defaults, "custom-provider"), "edits");
  assert.equal(sourceFor(defaults, "constructor"), "edits");
  assert.equal(sourceFor({ ...defaults, providers: { codex: "edits" } }, "codex"), "edits");
  assert.equal(
    sourceFor(settingsSchema.parse({ providers: { codex: "native" } }), "codex"),
    "native",
  );
});

test("设置持久化，并拒绝另一客户端提交的旧版本", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "turn-settings-"));
  try {
    const store = new Store(directory);
    const initial = await store.readSettings();
    const saved = await store.saveSettings(initial.revision, {
      ...initial.values,
      providers: { codex: "edits" },
    });
    assert.deepEqual(await new Store(directory).readSettings(), saved);
    await assert.rejects(store.saveSettings(initial.revision, initial.values), /另一处修改/);
    assert.deepEqual(await store.readSettings(), saved);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
