import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { codexRecordedItems, readCodexRecordedItems } from "../server/codex-records";
import { editsFromItems, recordedEdits } from "../server/differences";
import { reviewRecord } from "../server/review";
import type { Record } from "../server/store";

const sessionId = "01a08a0f-c3bb-77d2-9bbf-f3af4727879e";
const call = {
  type: "tool_call",
  status: "completed",
  callId: "file-edit-1",
  detail: { type: "edit", filePath: "new.ts", newString: "new\nfile\n" },
};
const event = {
  type: "event_msg",
  payload: {
    type: "item_completed",
    thread_id: sessionId,
    item: {
      type: "FileChange",
      id: call.callId,
      status: "completed",
      changes: {
        "/repo/new.ts": { type: "add", content: "new\nfile\n" },
        "/repo/second.ts": { type: "add", content: "second\n" },
      },
    },
  },
};
test("同一 Codex 调用补回新增差异和多文件，不伪造撤销快照", () => {
  const items = codexRecordedItems([call], [event], sessionId, "/repo");
  assert.equal(editsFromItems(items).length, 2);
  const original = {
    source: "edits",
    cwd: "/repo",
    canUndo: false,
    files: [
      {
        path: "new.ts",
        previousPath: null,
        before: null,
        after: null,
        patch: "",
        content: "new\nfile\n",
        additions: null,
        deletions: null,
        issue: "文件不在当前工作目录内。",
      },
    ],
  } as Record;
  const shown = reviewRecord(original, items);
  assert.deepEqual([shown.files[0].additions, shown.files[0].deletions], [2, 0]);
  assert.match(shown.files[0].patch, /--- \/dev\/null/);
  assert.equal(shown.files[0].before, null);
  assert.equal(shown.canUndo, false);
  assert.equal(original.files[0].patch, "");
});
test("其他会话、调用、失败结果、无新增标记的正文均保留原记录", () => {
  assert.deepEqual(codexRecordedItems([call], [event], "another-session", "/repo"), [call]);
  const other = { ...call, callId: "other" };
  assert.deepEqual(codexRecordedItems([other], [event], sessionId, "/repo"), [other]);
  const failed = { ...call, status: "failed" };
  assert.deepEqual(codexRecordedItems([failed], [event], sessionId, "/repo"), [failed]);
  const unknown = structuredClone(event);
  unknown.payload.item.changes["/repo/new.ts"].type = "update";
  assert.deepEqual(codexRecordedItems([call], [unknown], sessionId, "/repo"), [call]);
  assert.equal(recordedEdits("new.ts", editsFromItems([call])).patch, "");
});
test("绑定本机 Codex 会话日志；错误元数据和缺失日志不补充", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "turn-codex-"));
  try {
    await mkdir(path.join(root, "sessions", "2026"), { recursive: true });
    const file = path.join(root, "sessions", "2026", `rollout-${sessionId}.jsonl`);
    await writeFile(
      file,
      [
        JSON.stringify({ type: "session_meta", payload: { id: sessionId } }),
        JSON.stringify(event),
        "incomplete",
      ].join("\n"),
    );
    assert.equal((await readCodexRecordedItems([call], sessionId, "/repo", root)).length, 2);
    await writeFile(
      file,
      JSON.stringify({ type: "session_meta", payload: { id: "wrong" } }) +
        "\n" +
        JSON.stringify(event),
    );
    assert.deepEqual(await readCodexRecordedItems([call], sessionId, "/repo", root), [call]);
    assert.deepEqual(await readCodexRecordedItems([call], sessionId, "/repo", root + "-missing"), [
      call,
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
