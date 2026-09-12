import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewLines } from "../client/review-lines";
import { undoHint } from "../shared/undo-hint";
import { createFixture } from "./ui/fixture";
import type { Summary } from "../shared/contracts";

test("差异保留行号与代码内容，清理补丁头并分别高亮修改前后代码", () => {
  const lines = reviewLines(
    "Index: a.ts\n===\n--- a.ts\n+++ a.ts\n@@ -34,3 +34,3 @@\n // 中文\n-const before = 1;\n+const after = 2;\n \n",
    undefined,
    "a.ts",
  );
  assert.equal(lines[0].text, "省略 33 行");
  assert.equal(
    lines.some((line) => line.text.startsWith("Index:")),
    false,
  );
  const deleted = lines.find((line) => line.kind === "delete")!;
  const added = lines.find((line) => line.kind === "add")!;
  assert.equal(deleted.oldLine, 35);
  assert.equal(added.newLine, 35);
  for (const line of [deleted, added]) {
    assert.equal(line.tokens?.map((token) => token.text).join(""), line.text);
    assert.ok(line.tokens?.some((token) => token.style === "keyword"));
  }
  assert.equal(lines.at(-1)?.text, "");
});

test("重复编辑分段，不把上下文行或只有新内容的文件标成新增", () => {
  const patch = "--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-a\n+b\n";
  const lines = reviewLines(patch + patch, undefined, "a.unknown");
  assert.ok(lines.some((line) => line.text === "下一次编辑记录"));
  assert.equal(lines.filter((line) => line.kind === "add").length, 2);
  const content = reviewLines("", "const a = 1;\n", "a.ts");
  assert.ok(content.every((line) => line.kind === "context" && line.oldLine === null));
  assert.equal(content.map((line) => line.text).join("\n"), "const a = 1;\n");
  assert.deepEqual(reviewLines("", undefined, "a.ts"), []);
});

test("超长正文保留可读内容并跳过语法分析", () => {
  const source = "x".repeat(160_001);
  const lines = reviewLines("", source, "a.ts");
  assert.equal(lines[0].tokens, undefined);
  assert.equal(lines[0].text, source);
});

test("未识别的差异格式仍保留原文供审核", () => {
  const lines = reviewLines("@@\n-before\n+after", undefined, "a.txt");
  assert.equal(lines.map((line) => line.text).join("\n"), "@@\n-before\n+after");
});

test("禁用撤销提示汇总并去重原因，可撤销时无提示", async () => {
  const summary = (await createFixture().invoke("changes.read", {})) as Summary;
  assert.equal(undoHint(summary), undefined);
  const reason = "工作目录外文件，仅供查看，自动撤销不可用。";
  assert.equal(
    undoHint({
      ...summary,
      canUndo: false,
      issues: [reason],
      files: [{ ...summary.files[0], issue: reason }],
    }),
    `无法撤销：\n${reason}`,
  );
});
