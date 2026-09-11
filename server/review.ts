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

// Enrich only existing files from the exact historical turn; never read current files or enable undo.
export function reviewRecord(record: Record, items: readonly unknown[] = []): Record {
  const edits = editsFromItems(items);
  return {
    ...record,
    files: record.files.map((file) => {
      const matching = edits.filter(
        (edit) => path.relative(record.cwd, path.resolve(record.cwd, edit.path)) === file.path,
      );
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
