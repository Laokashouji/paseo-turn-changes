import type { PluginHostProps } from "@getpaseo/plugin/client";
import type { HighlightStyle } from "@getpaseo/highlight";

// The plugin theme exposes semantic colors, not the host's internal syntax palette.
export function syntaxColor(
  style: HighlightStyle | null,
  colors: PluginHostProps["theme"]["colors"],
) {
  switch (style) {
    case "comment":
      return colors.foregroundMuted;
    case "keyword":
    case "type":
    case "class":
    case "tag":
    case "heading":
    case "link":
      return colors.accent;
    case "string":
    case "regexp":
      return colors.statusSuccess;
    case "number":
    case "literal":
    case "function":
    case "definition":
    case "escape":
      return colors.statusWarning;
    default:
      return colors.foreground;
  }
}
