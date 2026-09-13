import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import type { Summary } from "../shared/contracts";
import { buildFileTree, type FileTreeNode } from "../shared/file-tree";
import { Counts } from "./card";
import { setHoverHint } from "./web";

export function FileTree({
  files,
  index,
  onSelect,
  theme,
}: {
  files: Summary["files"];
  index: number;
  onSelect: (index: number) => void;
  theme: PluginHostProps["theme"];
}) {
  const colors = theme.colors;
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const nodes = useMemo(() => buildFileTree(files, filter), [files, filter]);
  const selectedPath = files[index]?.path.replaceAll("\\", "/");
  useEffect(() => setCollapsed(new Set()), [filter]);
  useEffect(() => {
    setCollapsed(
      (current) => new Set([...current].filter((path) => !selectedPath?.startsWith(`${path}/`))),
    );
  }, [selectedPath]);
  function row(node: FileTreeNode, depth: number) {
    const folder = node.index === undefined;
    const expanded = !collapsed.has(node.path);
    const selected = node.index === index;
    const file = node.index === undefined ? undefined : files[node.index];
    return (
      <View key={node.id}>
        <Pressable
          ref={(element) => setHoverHint(element, node.path)}
          testID={folder ? "turn-file-directory" : "turn-file-entry"}
          accessibilityRole="button"
          accessibilityLabel={
            folder ? `${expanded ? "收起" : "展开"}目录 ${node.path}` : `选择文件 ${node.path}`
          }
          accessibilityState={folder ? { expanded } : { selected }}
          onPress={() => {
            if (!folder) {
              onSelect(node.index!);
              return;
            }
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(node.path)) next.delete(node.path);
              else next.add(node.path);
              return next;
            });
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            minHeight: 38,
            gap: 7,
            marginHorizontal: 6,
            borderRadius: 6,
            paddingLeft: 8 + Math.min(depth, 5) * 12,
            paddingRight: 8,
            backgroundColor: selected ? colors.surface2 : "transparent",
            borderLeftWidth: 2,
            borderLeftColor: selected ? colors.accent : "transparent",
          }}
        >
          <Icon
            name={folder ? (expanded ? "ChevronDown" : "ChevronRight") : "FileText"}
            size={16}
            color={colors.foregroundMuted}
          />
          <Text
            numberOfLines={1}
            ellipsizeMode="middle"
            style={{ color: colors.foreground, flex: 1, minWidth: 0, fontSize: 13 }}
          >
            {node.name}
          </Text>
          {file && file.additions !== null && file.deletions !== null && (
            <Counts theme={theme} additions={file.additions} deletions={file.deletions} />
          )}
        </Pressable>
        {folder && expanded && node.children.map((child) => row(child, depth + 1))}
      </View>
    );
  }
  return (
    <View
      testID="turn-file-tree"
      style={{ flex: 1, minHeight: 0, backgroundColor: colors.surface0 }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          margin: 10,
          paddingHorizontal: 10,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
        }}
      >
        <Icon name="Search" size={16} color={colors.foregroundMuted} />
        <TextInput
          accessibilityLabel="筛选改动文件"
          placeholder="筛选文件…"
          value={filter}
          onChangeText={setFilter}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={colors.foregroundMuted}
          style={{
            flex: 1,
            minWidth: 0,
            color: colors.foreground,
            fontSize: 13,
            paddingVertical: 10,
          }}
        />
        {filter !== "" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清除文件筛选"
            onPress={() => setFilter("")}
            style={{ padding: 4 }}
          >
            <Icon name="X" size={16} color={colors.foregroundMuted} />
          </Pressable>
        )}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 12 }}
      >
        {nodes.map((node) => row(node, 0))}
        {nodes.length === 0 && (
          <Text style={{ color: colors.foregroundMuted, padding: 16 }}>没有匹配的文件</Text>
        )}
      </ScrollView>
    </View>
  );
}
