import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import { copyText, Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { setHoverHint } from "./web";

export function FilePath({
  path,
  theme,
  compact,
  prefix = "",
  muted = false,
  onPress,
}: {
  path: string;
  theme: PluginHostProps["theme"];
  compact: boolean;
  prefix?: string;
  muted?: boolean;
  onPress: () => void;
}) {
  const { colors } = theme;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const directory = separator > 0 ? path.slice(0, separator) : "";
  const filename = path.slice(directory.length);
  const textStyle = {
    color: muted ? colors.foregroundMuted : colors.foreground,
    fontSize: muted ? 12 : 13,
  };
  const label =
    copyState === "copied"
      ? "已复制路径"
      : copyState === "error"
        ? "复制失败，点击重试"
        : "复制路径";
  async function copy() {
    try {
      await copyText(path);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => {
          setHovered(false);
          setCopyState("idle");
        }}
        style={{ flexDirection: "row", alignItems: "center", minWidth: 0, gap: 6 }}
      >
        <Pressable
          testID="turn-file-path"
          accessibilityRole="button"
          accessibilityLabel={`查看 ${path} 的本轮差异`}
          accessibilityHint="点击查看差异，长按查看并复制完整路径"
          ref={(node) => setHoverHint(node, path)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPress={onPress}
          onLongPress={() => {
            setCopyState("idle");
            setOpen(true);
          }}
          style={{ flexDirection: "row", flex: 1, minWidth: 0 }}
        >
          {prefix ? <Text style={{ ...textStyle, flexShrink: 0 }}>{prefix}</Text> : null}
          <View style={{ flexDirection: "row", flex: 1, minWidth: 0 }}>
            {directory ? (
              <Text numberOfLines={1} style={{ ...textStyle, minWidth: 0, flexShrink: 1 }}>
                {directory}
              </Text>
            ) : null}
            {/* Separate flex items keep the filename visible on React Native Web, which ignores middle ellipsis. */}
            <Text
              testID="turn-file-basename"
              numberOfLines={1}
              style={{ ...textStyle, flexShrink: 0, maxWidth: directory ? "80%" : "100%" }}
            >
              {filename}
            </Text>
          </View>
        </Pressable>
        {Platform.OS === "web" && !compact && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`复制完整路径 ${path}`}
            ref={(node) => setHoverHint(node, label)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onPress={(event) => {
              event.stopPropagation();
              void copy();
            }}
            style={{ padding: 3, opacity: hovered || focused ? 1 : 0 }}
          >
            <Icon
              name={
                copyState === "copied" ? "Check" : copyState === "error" ? "CircleAlert" : "Copy"
              }
              size={14}
              color={copyState === "error" ? colors.statusDanger : colors.foregroundMuted}
            />
          </Pressable>
        )}
      </View>
      <Modal title="完整文件路径" open={open} onOpenChange={setOpen}>
        <Modal.Content>
          <Text selectable style={{ color: colors.foreground, fontSize: 13 }}>
            {path}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void copy()}
            style={{ paddingVertical: 10 }}
          >
            <Text style={{ color: copyState === "error" ? colors.statusDanger : colors.accent }}>
              {label}
            </Text>
          </Pressable>
        </Modal.Content>
      </Modal>
    </View>
  );
}
