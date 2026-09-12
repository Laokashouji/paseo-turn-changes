import type { Summary } from "./contracts";

export function undoHint(summary: Summary): string | undefined {
  if (summary.canUndo) return undefined;
  if (summary.undoneAt) return "本轮改动已经撤销。";
  if (!summary.finishedAt) return "本轮仍在执行，结束后才能撤销。";
  const reasons = [
    ...new Set([...summary.issues, ...summary.files.map((file) => file.issue)]),
  ].filter((reason): reason is string => Boolean(reason));
  return reasons.length
    ? `无法撤销：\n${reasons.join("\n")}`
    : summary.files.length
      ? "缺少完整的修改前后快照，无法自动撤销。"
      : "本轮没有可撤销的文件改动。";
}
