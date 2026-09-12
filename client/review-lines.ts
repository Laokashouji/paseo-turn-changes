import { highlightCode, isLanguageSupported, type HighlightToken } from "@getpaseo/highlight";
import { diffLines, type DiffLine } from "../shared/diff-lines";

export type ReviewLine = DiffLine & { tokens?: HighlightToken[] };
const HIGHLIGHT_LIMIT = 160_000;

function highlightBlock(lines: ReviewLine[], path: string): void {
  if (!isLanguageSupported(path)) return;
  for (const side of ["old", "new"] as const) {
    const selected = lines.filter((line) =>
      side === "old" ? line.kind !== "add" : line.kind !== "delete",
    );
    const code = selected.map((line) => line.text).join("\n");
    if (code.length > HIGHLIGHT_LIMIT) continue;
    try {
      const tokens = highlightCode(code, path);
      selected.forEach((line, index) => {
        line.tokens = tokens[index];
      });
    } catch {
      // A parser failure must never hide the saved change.
    }
  }
}

export function reviewLines(
  patch: string,
  content: string | undefined,
  path: string,
): ReviewLine[] {
  if (!patch) {
    if (content === undefined) return [];
    const lines: ReviewLine[] = content.split("\n").map((text, index) => ({
      text,
      oldLine: null,
      newLine: index + 1,
      kind: "context",
    }));
    highlightBlock(lines, path);
    return lines;
  }
  const result: ReviewLine[] = [];
  let block: ReviewLine[] = [];
  let oldEnd = 1;
  let newEnd = 1;
  let section = 0;
  function flush() {
    highlightBlock(block, path);
    result.push(...block);
    block = [];
  }
  function meta(text: string) {
    result.push({ text, kind: "meta", oldLine: null, newLine: null });
  }
  for (const line of diffLines(patch)) {
    if (line.kind !== "meta") {
      block.push({ ...line, text: line.text.slice(1) });
      if (line.oldLine !== null) oldEnd = line.oldLine + 1;
      if (line.newLine !== null) newEnd = line.newLine + 1;
      continue;
    }
    const header = line.text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      flush();
      const oldStart = Number(header[1]);
      const newStart = Number(header[2]);
      const gap = Math.min(oldStart - oldEnd, newStart - newEnd);
      if (gap > 0) meta(`省略 ${gap} 行`);
      else if (section > 0) meta(`差异区段 · 原 ${oldStart} 行 / 新 ${newStart} 行`);
      section++;
    } else if (line.text.startsWith("--- ")) {
      flush();
      oldEnd = newEnd = 1;
      if (section) meta("下一次编辑记录");
    } else if (line.text.startsWith("\\")) {
      flush();
      meta("文件末尾没有换行符");
    } else if (line.text && !/^(?:Index:|index |diff --git |===|\+\+\+ )/.test(line.text)) {
      flush();
      meta(line.text);
    }
  }
  flush();
  return result;
}
