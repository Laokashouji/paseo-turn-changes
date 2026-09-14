import path from "node:path";
import { parsePatch } from "diff";
import { editsFromItems, patchCounts, recordedEdits } from "./differences";
import type { Record } from "./store";

export function reviewFile(file: Record["files"][number]): Record["files"][number] {
  const complete = !file.issue || file.before !== null || file.after !== null;
  let additions = file.additions;
  let deletions = file.deletions;
  if (file.patch && (additions === null || deletions === null)) {
    try {
      const patches = parsePatch(file.patch);
      if (patches.length) {
        const counts = patches.map(patchCounts);
        additions = counts.reduce((sum, count) => sum + count.additions, 0);
        deletions = counts.reduce((sum, count) => sum + count.deletions, 0);
      }
    } catch {
      /* Keep unavailable counts for malformed historical records. */
    }
  }
  const reviewKind = file.patch
    ? complete
      ? "net"
      : "edits"
    : file.content !== undefined
      ? "content"
      : "unavailable";
  let issue = file.issue;
  if (issue && reviewKind !== "unavailable") {
    if (issue === "文件不在当前工作目录内。") issue = "工作目录外文件，仅供查看，自动撤销不可用。";
    else if (issue === "文件内容与编辑记录不一致，无法完整还原。")
      issue = "文件在编辑后发生变化（如格式化），以下为已记录的编辑，自动撤销不可用。";
    else if (!issue.includes("撤销")) issue += " 自动撤销不可用。";
  }
  return { ...file, additions, deletions, reviewKind, issue };
}

// Append only paths newly recovered from a verified call, not net-zero files omitted at capture.
export function reviewRecord(
  record: Record,
  items: readonly unknown[] = [],
  originalItems: readonly unknown[] = items,
): Record {
  const edits = editsFromItems(items);
  const relative = (filePath: string) =>
    path.relative(record.cwd, path.resolve(record.cwd, filePath));
  const knownPaths = new Set([
    ...record.files.map((file) => file.path),
    ...editsFromItems(originalItems).map((edit) => relative(edit.path)),
  ]);
  const files = [...record.files];
  for (const edit of edits) {
    const filePath = relative(edit.path);
    if (knownPaths.has(filePath)) continue;
    knownPaths.add(filePath);
    files.push({
      path: filePath,
      previousPath: null,
      additions: null,
      deletions: null,
      patch: "",
      before: null,
      after: null,
      issue: "从本轮工具记录补充的文件，自动撤销不可用。",
    });
  }
  return {
    ...record,
    canUndo: record.canUndo && files.length === record.files.length,
    files: files.map((file) => {
      const matching = edits.filter((edit) => relative(edit.path) === file.path);
      const recovered = recordedEdits(file.path, matching);
      const result = reviewFile({
        ...file,
        patch: file.patch || recovered.patch,
        ...(file.content === undefined && recovered.content !== undefined
          ? { content: recovered.content }
          : {}),
      });
      if (record.source === "native" && result.patch) result.reviewKind = "net";
      return result;
    }),
  };
}
