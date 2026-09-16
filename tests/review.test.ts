import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { editsFromItems, parseDiff, reconstruct } from "../server/differences";
import { reviewFile, reviewRecord } from "../server/review";
import type { Record } from "../server/store";

test("格式化后仍能审核记录中的编辑和行数，不能伪造可撤销快照", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "review-format-"));
  try {
    await writeFile(path.join(cwd, "a.ts"), 'const x = "new";\n');
    const [file] = await reconstruct(
      cwd,
      parseDiff(createTwoFilesPatch("a.ts", "a.ts", "const x='old'\n", "const x='new'\n")),
    );
    const shown = reviewFile(file);
    assert.equal(shown.reviewKind, "edits");
    assert.deepEqual([shown.additions, shown.deletions], [1, 1]);
    assert.match(shown.patch, /-const x='old'\n\+const x='new'/);
    assert.match(shown.issue!, /格式化.*撤销不可用/);
    assert.equal(shown.before, null);
    assert.equal(shown.after, null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("外部路径只显示工具保存的差异，不读取该路径或开放撤销", async () => {
  const [file] = await reconstruct(
    os.tmpdir(),
    parseDiff(
      createTwoFilesPatch("/outside/not-present.txt", "/outside/not-present.txt", "a\n", "b\n"),
    ),
  );
  const shown = reviewFile(file);
  assert.deepEqual([shown.additions, shown.deletions], [1, 1]);
  assert.match(shown.issue!, /工作目录外.*撤销不可用/);
  assert.match(shown.patch, /-a\n\+b/);
  assert.equal(shown.before, null);
});

test("仅有 newString 时显示修改后内容，不把未知旧内容当作新增文件", async () => {
  const items = [
    {
      type: "tool_call",
      status: "completed",
      detail: { type: "edit", filePath: "/outside/unreadable.txt", newString: "script\n" },
    },
  ];
  const [file] = await reconstruct(os.tmpdir(), editsFromItems(items));
  const shown = reviewFile(file);
  assert.equal(shown.reviewKind, "content");
  assert.equal(shown.content, "script\n");
  assert.equal(shown.patch, "");
  assert.equal(shown.additions, null);
  assert.equal(shown.deletions, null);
});

test("旧记录从原始工具内容补充只读展示，保留历史和撤销状态", async () => {
  const [file] = await reconstruct(os.tmpdir(), [
    { kind: "unknown", path: "/outside/legacy.txt", reason: "缺少原文" },
  ]);
  const record = { cwd: os.tmpdir(), files: [file], canUndo: false, source: "edits" } as Record;
  const original = structuredClone(record);
  const shown = reviewRecord(record, [
    {
      type: "tool_call",
      status: "completed",
      detail: { type: "edit", filePath: "/outside/legacy.txt", newString: "saved content\n" },
    },
  ]);
  assert.equal(shown.files[0].reviewKind, "content");
  assert.equal(shown.files[0].content, "saved content\n");
  assert.equal(shown.canUndo, false);
  assert.deepEqual(record, original);
});

test("多次编辑的回退行数明确属于编辑记录合计，不能冒充净变化", async () => {
  const changes = [
    ...parseDiff(createTwoFilesPatch("/outside/a", "/outside/a", "old\n", "middle\n")),
    ...parseDiff(createTwoFilesPatch("/outside/a", "/outside/a", "middle\n", "final\n")),
  ];
  const [file] = await reconstruct(os.tmpdir(), changes);
  const shown = reviewFile(file);
  assert.equal(shown.reviewKind, "edits");
  assert.deepEqual([shown.additions, shown.deletions], [2, 2]);
  assert.match(shown.patch, /middle/);
});

test("OMP 展示差异不覆盖前后文本，已中断轮次仍能恢复已完成编辑的行数", () => {
  const record = {
    cwd: "/repo",
    source: "edits",
    outcome: "canceled",
    canUndo: false,
    files: [
      {
        path: "config.yml",
        previousPath: null,
        patch: "",
        before: null,
        after: null,
        additions: null,
        deletions: null,
        issue: "此改动没有文本差异，可能是二进制、权限或重命名操作。",
      },
    ],
  } as Record;
  const before = structuredClone(record);
  for (const unifiedDiff of [
    " 1|config:\n-2|  value: old\n+2|  value: new",
    "@@ broken @@\n+new",
  ]) {
    const shown = reviewRecord(record, [
      {
        type: "tool_call",
        status: "completed",
        detail: {
          type: "edit",
          filePath: "/repo/config.yml",
          unifiedDiff,
          oldString: "config:\n  value: old\n",
          newString: "config:\n  value: new\n",
        },
      },
    ]);
    assert.deepEqual([shown.files[0].additions, shown.files[0].deletions], [1, 1]);
    assert.match(shown.files[0].patch, /-  value: old\n\+  value: new/);
    assert.equal(shown.files[0].reviewKind, "edits");
    assert.equal(shown.canUndo, false);
    assert.deepEqual(record, before);
  }
});

test("Write 正文可审核但不伪造新增行数，未完成和失败调用不纳入", async () => {
  for (const content of ["first\nsecond\n", ""]) {
    const call = {
      type: "tool_call",
      status: "completed",
      detail: { type: "write", filePath: "/outside/written.txt", content },
    };
    const [file] = await reconstruct(os.tmpdir(), editsFromItems([call]));
    const shown = reviewFile(file);
    assert.equal(shown.reviewKind, "content");
    assert.equal(shown.content, content);
    assert.equal(shown.patch, "");
    assert.equal(shown.additions, null);
    assert.equal(shown.deletions, null);
    for (const status of ["running", "failed", "canceled"])
      assert.deepEqual(editsFromItems([{ ...call, status }]), []);
    const historical = {
      cwd: os.tmpdir(),
      source: "edits",
      canUndo: false,
      files: [{ ...file, content: undefined }],
    } as Record;
    assert.equal(reviewRecord(historical, [call]).files[0].content, content);
  }
});

test("有效统一差异仍然优先使用，缺少旧内容时不将展示差异当作补丁", () => {
  const call = {
    type: "tool_call",
    status: "completed",
    detail: {
      type: "edit",
      filePath: "a.txt",
      oldString: "stale",
      newString: "new\n",
      unifiedDiff: createTwoFilesPatch("a.txt", "a.txt", "old\n", "new\n"),
    },
  };
  assert.equal(editsFromItems([call])[0].kind, "patch");
  assert.equal(
    editsFromItems([
      {
        ...call,
        detail: {
          ...call.detail,
          oldString: undefined,
          unifiedDiff: "-1|old\n+1|new",
        },
      },
    ])[0].kind,
    "content",
  );
});
