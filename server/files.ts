import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isMissing, type Snapshot } from "./store";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function checkedPath(cwd: string, name: string): Promise<string> {
  const root = await realpath(cwd);
  const target = path.resolve(root, name);
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error("文件不在当前工作目录内。");
  }
  const parts = relative.split(path.sep);
  if (parts.includes(".git")) throw new Error("不处理 Git 内部文件。");
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) throw new Error("不处理符号链接文件或目录。");
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return target;
}

export async function snapshot(cwd: string, name: string): Promise<Snapshot | null> {
  const target = await checkedPath(cwd, name);
  try {
    const stat = await lstat(target);
    if (!stat.isFile()) throw new Error("只支持普通文本文件。");
    if (stat.size > MAX_FILE_BYTES) throw new Error("文件超过 2 MiB，未保存可撤销快照。");
    const bytes = await readFile(target);
    if (bytes.includes(0)) throw new Error("二进制文件不支持文本差异。");
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { text, mode: stat.mode & 0o777 };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export function sameSnapshot(left: Snapshot | null, right: Snapshot | null): boolean {
  if (left === null || right === null) return left === right;
  return left.text === right.text && left.mode === right.mode;
}
