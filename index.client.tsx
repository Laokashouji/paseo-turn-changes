import type { PluginClientContext } from "@getpaseo/plugin/client";
import { cardSchema } from "./shared/contracts";
import { TurnCard } from "./client/card";
import { SourcesSettings } from "./client/settings";
import { History } from "./client/history";
import { ReviewPanel } from "./client/review-panel";
import { createReviewNavigation, ReviewNavigation } from "./client/review-navigation";

export default function contribute(client: PluginClientContext) {
  const navigation = createReviewNavigation((id, options) => client.openPanel(id, options));
  client.addTimelineRenderer({
    kind: "turn-changes",
    version: 1,
    schema: cardSchema,
    Component: (props) => (
      <ReviewNavigation.Provider value={navigation}>
        <TurnCard {...props} />
      </ReviewNavigation.Provider>
    ),
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
    Component: (props) => (
      <ReviewNavigation.Provider value={navigation}>
        <History {...props} />
      </ReviewNavigation.Provider>
    ),
  });
  client.addWorkspacePanel({
    id: "review",
    title: "本轮代码差异",
    icon: "FileDiff",
    context: "agent",
    locations: ["explorer"],
    Component: (props) => (
      <ReviewNavigation.Provider value={navigation}>
        <ReviewPanel {...props} />
      </ReviewNavigation.Provider>
    ),
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
