import { useMemo } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc, type PluginHostProps } from "@getpaseo/plugin/client";
import { FlatList } from "@getpaseo/plugin/client/react-native";
import { getFile, type Summary } from "../shared/contracts";
import { Action } from "./card";
import { reviewLines } from "./review-lines";
import { syntaxColor } from "./syntax-color";

export function Review(
  props: PluginHostProps & {
    agentId: string;
    recordId: string;
    summary: Summary;
    index: number;
    setIndex: (index: number) => void;
    fill?: boolean;
  },
) {
  const { theme, host, layout, agentId, recordId, summary, index, setIndex } = props;
  const read = useRpc(getFile);
  const { height } = useWindowDimensions();
  const fontFamily = layout.platform === "ios" ? "Menlo" : "monospace";
  const query = useQuery({
    queryKey: [host.id, "turn-file", agentId, recordId, index],
    queryFn: () => read({ agentId, recordId, index }),
  });
  const lines = useMemo(
    () =>
      reviewLines(query.data?.patch ?? "", query.data?.content, summary.files[index]?.path ?? ""),
    [query.data?.patch, query.data?.content, summary.files, index],
  );
  return (
    <View
      testID="turn-changes-review"
      style={{
        ...(props.fill
          ? { flex: 1, minHeight: 0 }
          : { height: Math.min(layout.compact ? 430 : 600, Math.max(180, height - 200)) }),
        backgroundColor: theme.colors.surface0,
      }}
    >
      <View
        style={{ padding: 12, gap: 10, borderBottomWidth: 1, borderColor: theme.colors.border }}
      >
        <Text selectable style={{ color: theme.colors.foreground, fontSize: 13 }}>
          {summary.files[index]?.path}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          <Action
            theme={theme}
            label="上一个文件"
            disabled={index === 0}
            onPress={() => setIndex(index - 1)}
          />
          <Text style={{ color: theme.colors.foregroundMuted }}>
            {index + 1} / {summary.files.length}
          </Text>
          <Action
            theme={theme}
            label="下一个文件"
            disabled={index + 1 >= summary.files.length}
            onPress={() => setIndex(index + 1)}
          />
        </View>
      </View>
      {query.data?.reviewKind === "edits" && (
        <Text style={{ color: theme.colors.foregroundMuted, padding: 12 }}>
          编辑记录 · 行数为各次编辑合计
        </Text>
      )}
      {query.data?.reviewKind === "content" && (
        <Text style={{ color: theme.colors.foregroundMuted, padding: 12 }}>修改后内容</Text>
      )}
      {query.isPending && (
        <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>正在读取差异…</Text>
      )}
      {query.isError && (
        <View style={{ padding: 16, gap: 10 }}>
          <Text style={{ color: theme.colors.statusDanger }}>{query.error.message}</Text>
          <Action theme={theme} label="重试" onPress={() => void query.refetch()} />
        </View>
      )}
      {query.data?.reviewKind === "unavailable" && (
        <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>
          本条记录没有可展示的差异或文件内容。
        </Text>
      )}
      {query.data && (
        <FlatList
          style={{ flex: 1 }}
          data={lines}
          keyExtractor={(_, line) => String(line)}
          renderItem={({ item: line }) => {
            if (line.kind === "meta")
              return (
                <Text
                  style={{
                    color: theme.colors.foregroundMuted,
                    backgroundColor: theme.colors.surface2,
                    fontSize: 12,
                    padding: 10,
                    marginVertical: 6,
                    marginHorizontal: 6,
                    borderRadius: 8,
                  }}
                >
                  {line.text}
                </Text>
              );
            const changed = line.kind === "add" || line.kind === "delete";
            const color =
              line.kind === "add"
                ? theme.colors.statusSuccess
                : line.kind === "delete"
                  ? theme.colors.statusDanger
                  : theme.colors.foregroundMuted;
            const number = line.kind === "delete" ? line.oldLine : line.newLine;
            return (
              <View
                testID={`turn-diff-${line.kind}`}
                style={{
                  flexDirection: "row",
                  borderLeftWidth: 3,
                  borderLeftColor: changed ? color : "transparent",
                  minHeight: 22,
                }}
              >
                {changed && (
                  <View
                    pointerEvents="none"
                    style={[
                      StyleSheet.absoluteFillObject,
                      { backgroundColor: color, opacity: 0.13 },
                    ]}
                  />
                )}
                <Text
                  accessibilityLabel={
                    number === null ? "" : `${line.kind === "delete" ? "原" : "新"}行号 ${number}`
                  }
                  style={{
                    color,
                    width: layout.compact ? 42 : 52,
                    paddingRight: 10,
                    textAlign: "right",
                    fontFamily: "monospace",
                    fontSize: 12,
                    lineHeight: 22,
                  }}
                >
                  {number ?? ""}
                </Text>
                <Text
                  selectable
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: theme.colors.foreground,
                    fontFamily,
                    fontSize: 13,
                    lineHeight: 22,
                    paddingHorizontal: layout.compact ? 8 : 12,
                  }}
                >
                  {line.tokens?.length
                    ? line.tokens.map((token, index) => (
                        <Text
                          key={index}
                          style={{ color: syntaxColor(token.style, theme.colors), fontFamily }}
                        >
                          {token.text || " "}
                        </Text>
                      ))
                    : line.text || " "}
                </Text>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
