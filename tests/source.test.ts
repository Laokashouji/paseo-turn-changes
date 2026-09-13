import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveSource } from "../server/source";

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
