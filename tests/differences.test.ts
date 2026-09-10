import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createTwoFilesPatch } from "diff";
import { nativeFiles, parseDiff, reconstruct } from "../server/differences";

test("重复编辑合并为最终净变化，保留本轮之前的未提交内容", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-diff-"));
  try {
    const before = "user's uncommitted change\nold\n";
    const middle = "user's uncommitted change\nmiddle\n";
    const after = "user's uncommitted change\nfinal\n";
    await writeFile(path.join(cwd, "a.txt"), after);
    const changes = [
      ...parseDiff(createTwoFilesPatch("a.txt", "a.txt", before, middle)),
      ...parseDiff(createTwoFilesPatch("a.txt", "a.txt", middle, after)),
    ];
    const [file] = await reconstruct(cwd, changes);
    assert.equal(file.issue, null);
    assert.equal(file.before?.text, before);
    assert.equal(file.after?.text, after);
    assert.equal(file.additions, 1);
    assert.equal(file.deletions, 1);
    assert.equal(file.patch.includes("middle"), false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("新增、删除及改回原样", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-diff-"));
  try {
    await writeFile(path.join(cwd, "added.txt"), "new\n");
    await writeFile(path.join(cwd, "same.txt"), "old\n");
    const changes = [
      ...parseDiff(createTwoFilesPatch("/dev/null", "added.txt", "", "new\n")),
      ...parseDiff(
        `diff --git a/deleted.txt b/deleted.txt\ndeleted file mode 100644\n${createTwoFilesPatch("a/deleted.txt", "/dev/null", "deleted\n", "")}`,
      ),
      ...parseDiff(createTwoFilesPatch("same.txt", "same.txt", "old\n", "middle\n")),
      ...parseDiff(createTwoFilesPatch("same.txt", "same.txt", "middle\n", "old\n")),
    ];
    const files = await reconstruct(cwd, changes);
    assert.deepEqual(
      files.map((file) => [file.path, file.additions, file.deletions, file.issue]),
      [
        ["added.txt", 1, 0, null],
        ["deleted.txt", 0, 1, null],
      ],
    );
    assert.equal(files[0].before, null);
    assert.equal(files[1].after, null);
    assert.equal(files[1].before?.text, "deleted\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("文件已被再次修改或路径越界时，标明无法还原", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-diff-"));
  try {
    await writeFile(path.join(cwd, "a.txt"), "external edit\n");
    const [file] = await reconstruct(
      cwd,
      parseDiff(createTwoFilesPatch("a.txt", "a.txt", "old\n", "new\n")),
    );
    assert.match(file.issue!, /不一致/);
    assert.equal(file.additions, null);
    const [outside] = await reconstruct(
      cwd,
      parseDiff(createTwoFilesPatch("../outside.txt", "../outside.txt", "old\n", "new\n")),
    );
    assert.match(outside.issue!, /工作目录/);
    await symlink("/tmp", path.join(cwd, "link"));
    const [linked] = await reconstruct(
      cwd,
      parseDiff(createTwoFilesPatch("link/a", "link/a", "old\n", "new\n")),
    );
    assert.match(linked.issue!, /符号链接/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("Git 的中文转义路径解码为真实文件名，并保留原生差异证据", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-diff-"));
  try {
    const diff =
      'diff --git "a/\\346\\226\\207.txt" "b/\\346\\226\\207.txt"\n--- "a/\\346\\226\\207.txt"\n+++ "b/\\346\\226\\207.txt"\n@@ -1 +1 @@\n-old\n+new\n';
    await writeFile(path.join(cwd, "文.txt"), "new\n");
    const [file] = await nativeFiles(cwd, diff);
    assert.equal(file.path, "文.txt");
    assert.equal(file.before?.text, "old\n");
    assert.equal(file.issue, null);
    await writeFile(path.join(cwd, "文.txt"), "later\n");
    const [changed] = await nativeFiles(cwd, diff);
    assert.match(changed.issue!, /不一致/);
    assert.deepEqual([changed.additions, changed.deletions], [1, 1]);
    assert.match(changed.patch, /-old\n\+new/);
    assert.equal(changed.before, null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("UTF-8 BOM 和原有文件权限不会在还原时丢失", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-diff-"));
  try {
    const before = "\ufeffold\n";
    const after = "\ufeffnew\n";
    await writeFile(path.join(cwd, "script"), after, { mode: 0o644 });
    const diff = `diff --git a/script b/script\nold mode 100755\nnew mode 100644\n${createTwoFilesPatch("a/script", "b/script", before, after)}`;
    const [file] = await nativeFiles(cwd, diff);
    assert.equal(file.before?.text, before);
    assert.equal(file.after?.text, after);
    assert.equal(file.before?.mode, 0o755);
    assert.equal(file.after?.mode, 0o644);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
