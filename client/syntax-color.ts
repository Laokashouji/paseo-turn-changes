import type { PluginHostProps } from "@getpaseo/plugin/client";
import type { HighlightStyle } from "@getpaseo/highlight";

// Accent is a button background in some skins; use foreground status colors for code.
export function syntaxColor(
  style: HighlightStyle | null,
  colors: PluginHostProps["theme"]["colors"],
) {
  switch (style) {
    case "comment":
      return colors.foregroundMuted;
    case "keyword":
    case "tag":
      return colors.statusDanger;
    case "heading":
    case "link":
      return colors.foreground;
    case "string":
    case "regexp":
      return colors.statusSuccess;
    case "number":
    case "type":
    case "class":
    case "literal":
    case "function":
    case "definition":
    case "escape":
      return colors.statusWarning;
    default:
      return colors.foreground;
  }
}
