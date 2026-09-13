import { Linking, Platform } from "react-native";

declare const window: { location: { assign(url: string): void } };

export async function openSourceFile(serverId: string, workspaceId: string, encodedPath: string) {
  const route = `/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(workspaceId)}?open=${encodeURIComponent(`file:${encodedPath}`)}`;
  // Use the host's file route so its editor owns save/conflict handling.
  if (Platform.OS === "web") window.location.assign(route);
  else await Linking.openURL(`paseo://${route.slice(1)}`);
}

// Browser tooltips escape transcript clipping. Native clients use accessibilityHint.
export function setHoverHint(node: unknown, hint?: string) {
  if (Platform.OS !== "web" || !node) return;
  const element = node as {
    setAttribute?: (name: string, value: string) => void;
    removeAttribute?: (name: string) => void;
  };
  if (hint) element.setAttribute?.("title", hint);
  else element.removeAttribute?.("title");
}
