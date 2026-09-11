import { useMemo } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc, type PluginHostProps } from "@getpaseo/plugin/client";
import { FlatList } from "@getpaseo/plugin/client/react-native";
import { getFile, type Summary } from "../shared/contracts";
import { Action } from "./card";
import { diffLines } from "../shared/diff-lines";

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
  const query = useQuery({
    queryKey: [host.id, "turn-file", agentId, recordId, index],
    queryFn: () => read({ agentId, recordId, index }),
  });
  const lines = useMemo(
    () =>
      query.data?.content !== undefined && !query.data.patch
        ? query.data.content
            .split("\n")
            .map((text, index) => ({
              text,
              oldLine: null,
              newLine: index + 1,
              kind: "context" as const,
            }))
        : diffLines(query.data?.patch ?? ""),
    [query.data?.patch, query.data?.content],
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
          以下按编辑顺序展示记录。增删行数是这些记录的合计，可能包含重复修改及格式化前的内容。
        </Text>
      )}
      {query.data?.reviewKind === "content" && (
        <Text style={{ color: theme.colors.foregroundMuted, padding: 12 }}>
          工具只提供了修改后内容，无法计算增删行数。
        </Text>
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
      {query.data?.issue && (
        <Text style={{ color: theme.colors.statusWarning, padding: 12 }}>{query.data.issue}</Text>
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
            let color = theme.colors.foreground;
            if (line.kind === "add") color = theme.colors.statusSuccess;
            if (line.kind === "delete") color = theme.colors.statusDanger;
            if (line.kind === "meta") color = theme.colors.foregroundMuted;
            return (
              <View style={{ flexDirection: "row", paddingHorizontal: 8 }}>
                <Text
                  accessibilityLabel={line.oldLine === null ? "" : `原行号 ${line.oldLine}`}
                  style={{
                    color: theme.colors.foregroundMuted,
                    width: 42,
                    textAlign: "right",
                    fontFamily: "monospace",
                    fontSize: 11,
                    lineHeight: 20,
                  }}
                >
                  {line.oldLine ?? ""}
                </Text>
                <Text
                  accessibilityLabel={line.newLine === null ? "" : `新行号 ${line.newLine}`}
                  style={{
                    color: theme.colors.foregroundMuted,
                    width: 42,
                    textAlign: "right",
                    fontFamily: "monospace",
                    fontSize: 11,
                    lineHeight: 20,
                  }}
                >
                  {line.newLine ?? ""}
                </Text>
                <Text
                  selectable
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color,
                    fontFamily: layout.platform === "ios" ? "Menlo" : "monospace",
                    fontSize: 12,
                    lineHeight: 20,
                    paddingHorizontal: 12,
                  }}
                >
                  {line.text || " "}
                </Text>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
