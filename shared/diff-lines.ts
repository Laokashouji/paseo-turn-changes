export type DiffLine = {
  text: string;
  oldLine: number | null;
  newLine: number | null;
  kind: "add" | "delete" | "context" | "meta";
};

export function diffLines(patch: string): DiffLine[] {
  let oldLine = 0;
  let newLine = 0;
  let remainingOld = 0;
  let remainingNew = 0;
  return patch.split("\n").map((text) => {
    const header = text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      remainingOld = Number(header[2] ?? 1);
      remainingNew = Number(header[4] ?? 1);
    } else if (remainingOld || remainingNew) {
      if (text.startsWith("+") && remainingNew > 0) {
        remainingNew--;
        return { text, oldLine: null, newLine: newLine++, kind: "add" };
      }
      if (text.startsWith("-") && remainingOld > 0) {
        remainingOld--;
        return { text, oldLine: oldLine++, newLine: null, kind: "delete" };
      }
      if (text.startsWith(" ") && remainingOld > 0 && remainingNew > 0) {
        remainingOld--;
        remainingNew--;
        return { text, oldLine: oldLine++, newLine: newLine++, kind: "context" };
      }
    }
    return { text, oldLine: null, newLine: null, kind: "meta" };
  });
}
