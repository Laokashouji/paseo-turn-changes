import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PluginRpcProvider } from "@getpaseo/plugin/client/host";
import { RecordCard } from "../../client/card";
import { SourcesSettings } from "../../client/settings";
import { createFixture, lightTheme, props, recordId } from "./fixture";

export const fixture = createFixture();
const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
function Preview() {
  const [light, setLight] = useState(false);
  const [compact, setCompact] = useState(false);
  const [settings, setSettings] = useState(false);
  const theme = light ? lightTheme : props.theme;
  const hostProps = { ...props, theme, layout: { ...props.layout, compact } };
  return (
    <div
      style={
        {
          minHeight: "100vh",
          padding: compact ? 12 : 32,
          color: theme.colors.foreground,
          background: theme.colors.surface0,
          fontFamily: "system-ui",
          "--preview-surface": theme.colors.surface0,
        } as React.CSSProperties
      }
    >
      <main style={{ maxWidth: compact ? 366 : 1000, margin: "0 auto" }}>
        <p style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
          交互预览 · 真实插件组件使用模拟数据；弹窗和设置控件为测试替身。
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setLight(!light)}>{light ? "深色" : "浅色"}</button>
          <button onClick={() => setCompact(!compact)}>{compact ? "桌面宽度" : "手机宽度"}</button>
          <button onClick={() => setSettings(!settings)}>
            {settings ? "查看改动" : "数据来源设置"}
          </button>
        </div>
        {settings ? (
          <div style={{ marginTop: 24 }}>
            <SourcesSettings {...hostProps} />
          </div>
        ) : (
          <>
            <p style={{ marginTop: 36, color: theme.colors.foregroundMuted }}>用时 6m 24s</p>
            <p>本轮已完成文件修改。可以逐个审核，或撤销这一轮。</p>
            <RecordCard {...hostProps} agentId="preview-agent" recordId={recordId} />
          </>
        )}
      </main>
    </div>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(
  <QueryClientProvider client={queries}>
    <PluginRpcProvider invoke={fixture.invoke}>
      <Preview />
    </PluginRpcProvider>
  </QueryClientProvider>,
);
export function dispose() {
  root.unmount();
  queries.clear();
}
