import assert from "node:assert/strict";
import { test } from "node:test";
import { diffLines } from "../shared/diff-lines";

test("显示真实增删行号，正文的 --- 与 +++ 不误认成文件头", () => {
  const rows = diffLines(
    "--- file\n+++ file\n@@ -10,2 +20,2 @@\n context\n--- heading\n+++ heading\n@@ -0,0 +1 @@\n+created\n\\ No newline at end of file",
  );
  assert.deepEqual(
    rows.slice(3, 6).map(({ oldLine, newLine, kind }) => [oldLine, newLine, kind]),
    [
      [10, 20, "context"],
      [11, null, "delete"],
      [null, 21, "add"],
    ],
  );
  assert.deepEqual(
    rows.slice(7).map(({ oldLine, newLine, kind }) => [oldLine, newLine, kind]),
    [
      [null, 1, "add"],
      [null, null, "meta"],
    ],
  );
});
