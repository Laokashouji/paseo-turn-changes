import {
  applyPatch,
  createTwoFilesPatch,
  formatPatch,
  parsePatch,
  reversePatch,
  type StructuredPatch,
} from "diff";
import path from "node:path";
import { snapshot, MAX_FILE_BYTES } from "./files";
import type { Record } from "./store";

type File = Record["files"][number];
export type Edit =
  | { kind: "patch"; path: string; patch: StructuredPatch; oldMode?: number }
  | { kind: "replace"; path: string; oldText: string; newText: string }
  | { kind: "unknown"; path: string; reason: string };

function fileName(name: string | undefined): string | null {
  if (!name || name === "/dev/null") return null;
  if (
    [...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new Error("文件路径包含控制字符，暂不支持。");
  return name;
}

function headerName(raw: string): string {
  const token = raw.split("\t", 1)[0];
  if (!token.startsWith('"')) return token;
  if (!token.endsWith('"')) throw new Error("Git 文件路径的引号不完整。");
  const bytes: number[] = [];
  const escapes: { [key: string]: string } = {
    a: "\x07",
    b: "\b",
    t: "\t",
    n: "\n",
    v: "\v",
    f: "\f",
    r: "\r",
    '"': '"',
    "\\": "\\",
  };
  const value = token.slice(1, -1);
  for (let index = 0; index < value.length; ) {
    if (value[index] !== "\\") {
      const point = String.fromCodePoint(value.codePointAt(index)!);
      bytes.push(...Buffer.from(point));
      index += point.length;
    } else {
      const octal = value.slice(index + 1).match(/^[0-7]{3}/)?.[0];
      if (octal) {
        bytes.push(Number.parseInt(octal, 8));
        index += 4;
      } else {
        const escaped = escapes[value[index + 1]];
        if (escaped === undefined) throw new Error("Git 文件路径包含未知转义。");
        bytes.push(...Buffer.from(escaped));
        index += 2;
      }
    }
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
}

export function parseDiff(diff: string, fallbackPath?: string): Edit[] {
  if (!diff.trim()) return [];
  if (Buffer.byteLength(diff) > 12 * MAX_FILE_BYTES)
    throw new Error("本轮差异过大，无法完整保存。");
  let input = diff;
  if (diff.trimStart().startsWith("@@") && fallbackPath)
    input = `--- ${fallbackPath}\n+++ ${fallbackPath}\n${diff}`;
  // File separators cannot occur in hunk content without a diff-line prefix.
  const segments = input.split(/(?=^(?:diff --git |Index: ))/m).filter((part) => part.trim());
  const parsed = segments.flatMap((segment) => {
    const patches = parsePatch(segment);
    if (patches.length === 1) {
      // jsdiff unquotes names but does not decode Git octal UTF-8 bytes.
      const headers = segment.split(/^@@/m, 1)[0];
      const old = headers.match(/^--- (.*)$/m)?.[1];
      const next = headers.match(/^\+\+\+ (.*)$/m)?.[1];
      if (old !== undefined) patches[0].oldFileName = headerName(old);
      if (next !== undefined) patches[0].newFileName = headerName(next);
    }
    return patches.map((patch) => ({ patch, segment }));
  });
  if (!parsed.length) throw new Error("未识别到有效的统一差异格式。");
  return parsed.map(({ patch, segment }) => {
    const isGit =
      (patch.oldFileName?.startsWith("a/") && patch.newFileName?.startsWith("b/")) ||
      (patch.oldFileName?.startsWith("a/") && patch.newFileName === "/dev/null") ||
      (patch.oldFileName === "/dev/null" && patch.newFileName?.startsWith("b/"));
    if (isGit) {
      if (patch.oldFileName?.startsWith("a/")) patch.oldFileName = patch.oldFileName.slice(2);
      if (patch.newFileName?.startsWith("b/")) patch.newFileName = patch.newFileName.slice(2);
    }
    const name = fileName(patch.newFileName) ?? fileName(patch.oldFileName) ?? fallbackPath;
    if (!name) throw new Error("差异缺少文件路径。");
    if (!patch.hunks.length)
      return {
        kind: "unknown",
        path: name,
        reason: "此改动没有文本差异，可能是二进制、权限或重命名操作。",
      };
    const mode = segment.match(/^(?:deleted file mode|old mode) (100[0-7]{3})$/m)?.[1];
    return {
      kind: "patch",
      path: name,
      patch,
      oldMode: mode ? Number.parseInt(mode, 8) & 0o777 : undefined,
    };
  });
}

export async function nativeFiles(cwd: string, diff: string): Promise<File[]> {
  const edits = parseDiff(diff);
  const files = await reconstruct(cwd, edits);
  return files.map((file) => {
    if (!file.issue) return file;
    const edit = edits.find(
      (value) => path.relative(cwd, path.resolve(cwd, value.path)) === file.path,
    );
    if (!edit || edit.kind !== "patch") return file;
    const counts = patchCounts(edit.patch);
    return { ...file, patch: formatPatch(edit.patch), ...counts };
  });
}

function patchCounts(patch: StructuredPatch) {
  let additions = 0;
  let deletions = 0;
  for (const hunk of patch.hunks)
    for (const line of hunk.lines) {
      if (line.startsWith("+")) additions++;
      if (line.startsWith("-")) deletions++;
    }
  return { additions, deletions };
}

export function editsFromItems(items: readonly unknown[]): Edit[] {
  const edits: Edit[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      type?: string;
      status?: string;
      detail?: {
        type?: string;
        filePath?: string;
        unifiedDiff?: string;
        oldString?: string;
        newString?: string;
      };
    };
    if (row.type !== "tool_call" || row.status !== "completed" || !row.detail?.filePath) continue;
    const detail = row.detail;
    const name = detail.filePath!;
    if (detail.type === "edit" && detail.unifiedDiff) {
      try {
        edits.push(...parseDiff(detail.unifiedDiff, name));
      } catch (error) {
        edits.push({ kind: "unknown", path: name, reason: message(error) });
      }
    } else if (
      detail.type === "edit" &&
      detail.oldString !== undefined &&
      detail.newString !== undefined
    ) {
      edits.push({
        kind: "replace",
        path: name,
        oldText: detail.oldString,
        newText: detail.newString,
      });
    } else if (detail.type === "edit" || detail.type === "write") {
      edits.push({
        kind: "unknown",
        path: name,
        reason: "编辑记录没有完整的修改前内容，无法准确还原。",
      });
    }
  }
  return edits;
}

export async function reconstruct(cwd: string, edits: Edit[]): Promise<File[]> {
  const grouped = new Map<string, Edit[]>();
  for (const edit of edits) {
    const relative = path.relative(cwd, path.resolve(cwd, edit.path));
    const list = grouped.get(relative) ?? [];
    list.push(edit);
    grouped.set(relative, list);
  }
  if (grouped.size > 200) throw new Error("本轮超过 200 个文件，未生成完整记录。");
  const files: File[] = [];
  let totalBytes = 0;
  for (const [name, changes] of grouped) {
    const file = await reconstructFile(cwd, name, changes);
    totalBytes +=
      Buffer.byteLength(file.before?.text ?? "") + Buffer.byteLength(file.after?.text ?? "");
    if (totalBytes > 12 * MAX_FILE_BYTES) throw new Error("本轮快照超过 24 MiB，未生成完整记录。");
    if (file.issue || file.patch) files.push(file);
  }
  return files;
}

async function reconstructFile(cwd: string, name: string, changes: Edit[]): Promise<File> {
  const base: File = {
    path: name,
    previousPath: null,
    additions: null,
    deletions: null,
    issue: null,
    patch: "",
    before: null,
    after: null,
  };
  try {
    const after = await snapshot(cwd, name);
    let text = after?.text ?? "";
    let exists = after !== null;
    let previousPath: string | null = null;
    let originalMode = after?.mode;
    for (const change of [...changes].reverse()) {
      if (change.kind === "unknown") throw new Error(change.reason);
      if (change.kind === "replace") {
        if (!exists) throw new Error("编辑后的文件不存在。");
        if (!change.newText || text.split(change.newText).length !== 2)
          throw new Error("无法唯一定位这次编辑，可能已有后续修改。");
        text = text.replace(change.newText, () => change.oldText);
        continue;
      }
      const oldPath = fileName(change.patch.oldFileName);
      const newPath = fileName(change.patch.newFileName);
      if (change.oldMode !== undefined) originalMode = change.oldMode;
      if ((newPath === null) !== !exists) throw new Error("文件的新增或删除状态与编辑记录不一致。");
      const restored = applyPatch(text, reversePatch(change.patch), {
        fuzzFactor: 0,
        autoConvertLineEndings: false,
      });
      if (restored === false) throw new Error("文件内容与编辑记录不一致，无法完整还原。");
      text = restored;
      exists = oldPath !== null;
      if (!exists && text !== "") throw new Error("新增文件还有未记录的内容。");
      if (oldPath && newPath && oldPath !== newPath)
        previousPath = path.relative(cwd, path.resolve(cwd, oldPath));
    }
    if (previousPath) throw new Error("重命名改动暂不支持自动还原。");
    const before = exists ? { text, mode: originalMode ?? 0o644 } : null;
    const patch = createTwoFilesPatch(
      before ? name : "/dev/null",
      after ? name : "/dev/null",
      before?.text ?? "",
      after?.text ?? "",
      "",
      "",
      { context: 3 },
    );
    const parsed = parsePatch(patch)[0];
    const { additions, deletions } = patchCounts(parsed);
    const changed = before === null || after === null || before.text !== after.text;
    const issue =
      exists && originalMode === undefined
        ? "删除记录没有原文件权限，差异可查看，自动撤销不可用。"
        : null;
    return { ...base, before, after, additions, deletions, issue, patch: changed ? patch : "" };
  } catch (error) {
    const patches = changes
      .filter((change) => change.kind === "patch")
      .map((change) => formatPatch(change.patch));
    return { ...base, issue: message(error), patch: patches.join("\n") };
  }
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
