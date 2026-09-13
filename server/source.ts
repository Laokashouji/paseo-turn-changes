import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isMissing } from "./store";

const workspaceSchema = z.object({
  cwd: z.string(),
  mainRepoRoot: z.string().nullable().optional(),
  isPaseoOwnedWorktree: z.boolean().optional(),
  archivedAt: z.string().nullable().optional(),
});
function contains(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function existingFile(target: string) {
  try {
    if (!(await stat(target)).isFile()) throw new Error("源路径不是文件。");
    return await realpath(target);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function resolveSource(cwd: string, name: string, paseoHome: string) {
  const original = path.resolve(cwd, name);
  if (original.split(path.sep).includes(".git")) throw new Error("不打开 Git 内部文件。");
  let absolutePath = await existingFile(original);
  let root = cwd;
  if (!absolutePath) {
    // Archived worktree ownership is retained by Paseo after the directory is removed.
    // Only that exact mapping can redirect a historical path to its main checkout.
    let workspaces: z.infer<typeof workspaceSchema>[] = [];
    try {
      const rows: unknown = JSON.parse(
        await readFile(path.join(paseoHome, "projects", "workspaces.json"), "utf8"),
      );
      if (Array.isArray(rows))
        workspaces = rows.flatMap((row) => {
          const parsed = workspaceSchema.safeParse(row);
          return parsed.success ? [parsed.data] : [];
        });
    } catch {
      /* Missing metadata must not guess a repository by file name. */
    }
    const owner = workspaces
      .filter(
        (entry) =>
          entry.isPaseoOwnedWorktree &&
          entry.archivedAt &&
          entry.mainRepoRoot &&
          contains(entry.cwd, original),
      )
      .sort((a, b) => b.cwd.length - a.cwd.length)[0];
    if (owner?.mainRepoRoot) {
      root = owner.mainRepoRoot;
      absolutePath = await existingFile(path.resolve(root, path.relative(owner.cwd, original)));
      if (absolutePath && !contains(await realpath(root), absolutePath))
        throw new Error("源文件链接指向主仓库之外。");
    }
  }
  if (!absolutePath) throw new Error("源文件已删除或移动，未找到可打开的实际文件。");
  try {
    root = await realpath(root);
  } catch {
    root = path.dirname(absolutePath);
  }
  if (!contains(root, absolutePath)) root = path.dirname(absolutePath);
  return { cwd: root, path: path.relative(root, absolutePath), absolutePath };
}
