import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PluginRpcProvider } from "@getpaseo/plugin/client/host";
import { RecordCard } from "../../client/card";
import { SourcesSettings } from "../../client/settings";
import { ReviewPanel } from "../../client/review-panel";
import { createReviewNavigation, ReviewNavigation } from "../../client/review-navigation";
import { createFixture, lightTheme, props, recordId } from "./fixture";

export const fixture = createFixture();
const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
export const openedPanels: unknown[] = [];
let showPanel: (open: boolean) => void = () => {};
const navigation = createReviewNavigation((id, options) => {
  openedPanels.push({ id, ...options });
  showPanel(true);
});
function Preview() {
  const [light, setLight] = useState(false);
  const [compact, setCompact] = useState(false);
  const [settings, setSettings] = useState(false);
  const [panel, setPanel] = useState(false);
  showPanel = setPanel;
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
          交互预览 · 真实插件组件使用模拟数据；面板、弹窗和设置控件为测试替身。
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
            <RecordCard
              {...hostProps}
              workspaceId="preview-workspace"
              agentId="preview-agent"
              recordId={recordId}
            />
          </>
        )}
      </main>
      {panel && (
        <aside
          aria-label="本轮代码差异"
          style={{
            position: "fixed",
            right: 0,
            top: 0,
            bottom: 0,
            width: compact ? "100%" : "50%",
            display: "flex",
            flexDirection: "column",
            background: theme.colors.surface0,
            borderLeft: `1px solid ${theme.colors.border}`,
            zIndex: 1,
          }}
        >
          <button aria-label="关闭审核面板" onClick={() => setPanel(false)}>
            关闭审核面板
          </button>
          <ReviewPanel
            {...hostProps}
            context="agent"
            workspaceId="preview-workspace"
            agentId="preview-agent"
          />
        </aside>
      )}
    </div>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(
  <QueryClientProvider client={queries}>
    <PluginRpcProvider invoke={fixture.invoke}>
      <ReviewNavigation.Provider value={navigation}>
        <Preview />
      </ReviewNavigation.Provider>
    </PluginRpcProvider>
  </QueryClientProvider>,
);
export function dispose() {
  root.unmount();
  queries.clear();
}
