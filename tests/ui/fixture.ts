import type { PluginHostProps } from "@getpaseo/plugin/client";
import { settingsSchema, type Summary, type Settings } from "../../shared/contracts";

export const props: PluginHostProps = {
  host: { id: "preview", label: "模拟主机" },
  layout: { compact: false, platform: "web" },
  theme: {
    colors: {
      surface0: "#121212",
      surface1: "#1b1b1b",
      surface2: "#262626",
      border: "#383838",
      foreground: "#ececec",
      foregroundMuted: "#a6a6a6",
      accent: "#80bbef",
      accentForeground: "#111",
      statusSuccess: "#24bb7b",
      statusDanger: "#f05d62",
      statusWarning: "#e6b15d",
    },
  },
};
export const lightTheme: PluginHostProps["theme"] = {
  colors: {
    surface0: "#fff",
    surface1: "#fafafa",
    surface2: "#f2f2f2",
    border: "#ddd",
    foreground: "#252525",
    foregroundMuted: "#666",
    accent: "#236ec4",
    accentForeground: "#fff",
    statusSuccess: "#087b40",
    statusDanger: "#c02436",
    statusWarning: "#936300",
  },
};
export const recordId = "db0f9531-a05b-4689-a502-0555fb306c4f";
const files = ["src/agent/change-tracker.ts", "README.md"].map((path) => ({
  path,
  previousPath: null,
  additions: 1,
  deletions: 1,
  issue: null,
}));

export function createFixture() {
  let record: Summary = {
    id: recordId,
    agentId: "preview-agent",
    provider: "codex",
    source: "native",
    startedAt: "2026-09-10T08:00:00Z",
    finishedAt: "2026-09-10T08:06:24Z",
    outcome: "completed",
    issues: [],
    files,
    canUndo: true,
    undoneAt: null,
    undoState: "ready",
  };
  let settings = { revision: "initial", values: settingsSchema.parse({}) };
  const state = { failUndo: false, calls: [] as string[] };
  async function invoke(method: string, raw: unknown): Promise<unknown> {
    state.calls.push(method);
    const input = raw as { index?: number; revision?: string; values?: Settings };
    if (method === "changes.read") return record;
    if (method === "changes.list") return [record];
    if (method === "changes.source")
      throw new Error("源文件已删除或移动，未找到可打开的实际文件。");
    if (method === "changes.file") {
      const file = files[input.index!];
      return {
        ...file,
        patch: `--- ${file.path}\n+++ ${file.path}\n@@ -1 +1 @@\n-${input.index === 0 ? "const source = 'git';" : "旧说明"}\n+${input.index === 0 ? "const source = 'native';" : "按轮次展示文件差异"}\n`,
      };
    }
    if (method === "changes.undo") {
      if (state.failUndo) throw new Error("文件已有后续修改，未撤销任何文件。");
      record = { ...record, canUndo: false, undoState: "done", undoneAt: new Date().toISOString() };
      return record;
    }
    if (method === "sources.read") return settings;
    if (method === "sources.native-status")
      return { codex: { available: false, observedAt: "2026-09-11T08:00:00Z" } };
    if (method === "sources.save") {
      if (input.revision !== settings.revision)
        throw new Error("设置已在另一处修改，请刷新后重新保存。");
      settings = {
        revision: String(Number(settings.revision) + 1 || 1),
        values: settingsSchema.parse(input.values),
      };
      return settings;
    }
    throw new Error(`Unknown fixture RPC: ${method}`);
  }
  return { invoke, state, settings: () => settings };
}
