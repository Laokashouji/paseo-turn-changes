import { createContext, useContext, useSyncExternalStore } from "react";
import type { PluginClientContext } from "@getpaseo/plugin/client";

type Selection = { recordId: string; index: number };
export function createReviewNavigation(openPanel: PluginClientContext["openPanel"]) {
  const selections = new Map<string, Selection>();
  const listeners = new Set<() => void>();
  return {
    get: (agentId: string) => selections.get(agentId),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select(agentId: string, selection: Selection) {
      selections.set(agentId, selection);
      listeners.forEach((listener) => listener());
    },
    open(workspaceId: string, agentId: string, selection: Selection) {
      this.select(agentId, selection);
      openPanel("review", { workspaceId, agentId, location: "explorer" });
    },
  };
}
export const ReviewNavigation = createContext<ReturnType<typeof createReviewNavigation> | null>(
  null,
);
export function useReviewSelection(agentId: string) {
  const navigation = useContext(ReviewNavigation);
  const selected = useSyncExternalStore(navigation?.subscribe ?? (() => () => {}), () =>
    navigation?.get(agentId),
  );
  return { navigation, selected };
}
