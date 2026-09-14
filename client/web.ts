import { Platform } from "react-native";

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
