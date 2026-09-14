import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, stat, chmod, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveSource, readSource, writeSource } from "../server/source";

test("源文件打开保留精确路径；归档 worktree 按主仓库映射，拒绝猜测和越界链接", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "turn-source-"));
  const home = path.join(root, "paseo"),
    repo = path.join(root, "repo"),
    worktree = path.join(root, "removed");
  try {
    await mkdir(path.join(home, "projects"), { recursive: true });
    await mkdir(path.join(repo, "src"), { recursive: true });
    await writeFile(path.join(repo, "src", "带 空格.ts"), "current\n");
    await writeFile(
      path.join(home, "projects", "workspaces.json"),
      JSON.stringify([
        { cwd: worktree, mainRepoRoot: repo, isPaseoOwnedWorktree: true, archivedAt: "2026-09-14" },
      ]),
    );
    const direct = await resolveSource(repo, "src/带 空格.ts", home);
    assert.equal(direct.path, "src/带 空格.ts");
    assert.deepEqual(await resolveSource(root, "removed/src/带 空格.ts", home), direct);
    await assert.rejects(resolveSource(root, "another/src/带 空格.ts", home), /删除或移动/);
    await assert.rejects(resolveSource(repo, ".git/config", home), /Git 内部/);
    await writeFile(path.join(root, "outside.txt"), "outside");
    const external = await resolveSource(repo, "../outside.txt", home);
    assert.equal(external.cwd, root);
    assert.equal(external.path, "outside.txt");
    await symlink(path.join(root, "outside.txt"), path.join(repo, "src", "linked.txt"));
    await assert.rejects(resolveSource(root, "removed/src/linked.txt", home), /主仓库之外/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("侧栏保存真实文件并保留权限、BOM 和换行；旧版本及重定向不覆盖文件", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "source-save-"));
  const file = path.join(root, "script.ts");
  const source = { path: "script.ts", absolutePath: file };
  try {
    await writeFile(file, "\ufeffold\r\n");
    await chmod(file, 0o755);
    const before = await readSource(source);
    const saved = await writeSource(source, { ...before, content: "\ufeffnew\r\n" });
    assert.equal(await readFile(file, "utf8"), "\ufeffnew\r\n");
    assert.equal((await stat(file)).mode & 0o777, 0o755);
    assert.notEqual(saved.revision, before.revision);
    await assert.rejects(writeSource(source, { ...before, content: "stale" }), /其他地方修改/);
    assert.equal(await readFile(file, "utf8"), saved.content);
    await writeFile(file, "external\n");
    await assert.rejects(writeSource(source, { ...saved, content: "overwrite" }), /其他地方修改/);
    assert.equal(await readFile(file, "utf8"), "external\n");
    await assert.rejects(
      writeSource(source, { ...saved, absolutePath: root + "/other", content: "wrong" }),
      /其他地方修改/,
    );
    const current = await readSource(source);
    const empty = await writeSource(source, { ...current, content: "" });
    assert.equal(empty.content, "");
    assert.equal((await stat(file)).size, 0);
    await assert.rejects(writeSource(source, { ...empty, content: "\0" }), /二进制/);
    await writeFile(file, Buffer.from([0xff, 0xfe, 0xff]));
    await assert.rejects(readSource(source), /UTF-8/);
    await writeFile(file, Buffer.alloc(1024 * 1024 + 1, 97));
    await assert.rejects(readSource(source), /1 MiB/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
