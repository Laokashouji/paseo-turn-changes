import type { PluginClientContext } from "@getpaseo/plugin/client";
import { cardSchema } from "./shared/contracts";
import { TurnCard } from "./client/card";
import { SourcesSettings } from "./client/settings";
import { History } from "./client/history";

export default function contribute(client: PluginClientContext) {
  client.addTimelineRenderer({
    kind: "turn-changes",
    version: 1,
    schema: cardSchema,
    Component: TurnCard,
  });
  client.addSettingsScreen({
    id: "sources",
    title: "数据来源",
    icon: "SlidersHorizontal",
    Component: SourcesSettings,
  });
  client.addWorkspacePanel({
    id: "history",
    title: "每轮改动",
    icon: "FileDiff",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: History,
  });
  client.addCommandCenterItem({
    id: "history",
    title: "查看每轮改动",
    icon: "FileDiff",
    context: "agent",
    onSelect({ openPanel }) {
      openPanel("history");
    },
  });
  client.addCommandCenterItem({
    id: "sources",
    title: "配置每轮改动来源",
    icon: "Settings",
    context: "global",
    onSelect({ openSettings }) {
      openSettings("sources");
    },
  });
  return () => {};
}
