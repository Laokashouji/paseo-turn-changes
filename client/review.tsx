import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRpc, type PluginHostProps } from "@getpaseo/plugin/client";
import { FlatList, Icon } from "@getpaseo/plugin/client/react-native";
import { getFile, getSource, type Summary, type SourceDocument } from "../shared/contracts";
import { Action, Counts } from "./card";
import { reviewLines } from "./review-lines";
import { syntaxColor } from "./syntax-color";
import { FileTree } from "./file-tree";
import { setHoverHint } from "./web";
import { SourceEditor } from "./source-editor";

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
  const source = useRpc(getSource);
  const [sourceDocument, setSourceDocument] = useState<{
    recordId: string;
    index: number;
    document: SourceDocument;
  } | null>(null);
  const open = useMutation({
    mutationFn: async (index: number) => {
      const document = await source({ agentId, recordId, index });
      return { recordId, index, document };
    },
    onSuccess: setSourceDocument,
  });
  const { height } = useWindowDimensions();
  const [panelWidth, setPanelWidth] = useState(0);
  const [treeHidden, setTreeHidden] = useState(false);
  const [fileListOpen, setFileListOpen] = useState(false);
  useEffect(() => setFileListOpen(false), [recordId, index]);
  useEffect(() => open.reset(), [recordId, index]);
  const wide = panelWidth >= 680 && !layout.compact;
  const showTree = wide ? !treeHidden : fileListOpen;
  const selectedFile = summary.files[index];
  const totalsKnown =
    summary.files.length > 0 &&
    summary.files.every((file) => file.additions !== null && file.deletions !== null);
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
  if (sourceDocument && sourceDocument.recordId === recordId && sourceDocument.index === index)
    return (
      <SourceEditor
        {...props}
        document={sourceDocument.document}
        onClose={() => setSourceDocument(null)}
      />
    );
  return (
    <View
      testID="turn-changes-review"
      onLayout={(event) => setPanelWidth(event.nativeEvent.layout.width)}
      style={{
        ...(props.fill
          ? { flex: 1, minHeight: 0 }
          : { height: Math.min(layout.compact ? 430 : 600, Math.max(180, height - 200)) }),
        backgroundColor: theme.colors.surface0,
      }}
    >
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 8,
          flexDirection: "row",
          alignItems: "center",
          borderBottomWidth: 1,
          borderColor: theme.colors.border,
          flexWrap: "wrap",
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>
          本轮改动 · {summary.files.length} 个文件
        </Text>
        {totalsKnown && (
          <Counts
            theme={theme}
            additions={summary.files.reduce((n, file) => n + file.additions!, 0)}
            deletions={summary.files.reduce((n, file) => n + file.deletions!, 0)}
          />
        )}
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showTree ? (wide ? "隐藏文件列表" : "返回差异") : "显示文件列表"}
          accessibilityState={{ expanded: showTree }}
          onPress={() => (wide ? setTreeHidden(!treeHidden) : setFileListOpen(!fileListOpen))}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            padding: 8,
            borderRadius: 6,
            backgroundColor: showTree ? theme.colors.surface2 : "transparent",
          }}
        >
          <Icon
            name={showTree && !wide ? "ArrowLeft" : "Files"}
            size={18}
            color={theme.colors.foregroundMuted}
          />
          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
            {showTree && !wide ? "返回差异" : "文件"}
          </Text>
        </Pressable>
      </View>
      <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
        <View
          testID="turn-diff-content"
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: !wide && showTree ? "none" : "flex",
          }}
        >
          <View
            style={{ padding: 12, gap: 10, borderBottomWidth: 1, borderColor: theme.colors.border }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name="FileText" size={16} color={theme.colors.foregroundMuted} />
              <Text
                selectable
                numberOfLines={1}
                ellipsizeMode="middle"
                style={{ color: theme.colors.foreground, fontSize: 13, flex: 1, minWidth: 0 }}
              >
                {selectedFile?.path}
              </Text>
              {selectedFile?.additions != null && selectedFile.deletions != null && (
                <Counts
                  theme={theme}
                  additions={selectedFile.additions}
                  deletions={selectedFile.deletions}
                />
              )}
              <Pressable
                ref={(node) => setHoverHint(node, "打开源文件")}
                accessibilityRole="button"
                accessibilityLabel="打开源文件"
                disabled={open.isPending}
                onPress={() => open.mutate(index)}
                style={{ padding: 8, opacity: open.isPending ? 0.4 : 1 }}
              >
                <Icon name="SquareArrowOutUpRight" size={17} color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>
            {selectedFile?.previousPath && (
              <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                重命名自 {selectedFile.previousPath}
              </Text>
            )}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="上一个文件"
                disabled={index === 0}
                accessibilityState={{ disabled: index === 0 }}
                onPress={() => setIndex(index - 1)}
                style={{ padding: 6, opacity: index === 0 ? 0.4 : 1 }}
              >
                <Icon name="ChevronLeft" size={18} color={theme.colors.foregroundMuted} />
              </Pressable>
              <Text style={{ color: theme.colors.foregroundMuted }}>
                {index + 1} / {summary.files.length}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="下一个文件"
                disabled={index + 1 >= summary.files.length}
                accessibilityState={{ disabled: index + 1 >= summary.files.length }}
                onPress={() => setIndex(index + 1)}
                style={{ padding: 6, opacity: index + 1 >= summary.files.length ? 0.4 : 1 }}
              >
                <Icon name="ChevronRight" size={18} color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>
          </View>
          {open.isError && (
            <Text style={{ color: theme.colors.statusDanger, padding: 12 }}>
              {open.error.message}
            </Text>
          )}
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
              key={`${recordId}:${index}`}
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
                        number === null
                          ? ""
                          : `${line.kind === "delete" ? "原" : "新"}行号 ${number}`
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
        {showTree && (
          <View
            style={{
              ...(wide
                ? { width: Math.min(300, Math.max(230, panelWidth * 0.34)), borderLeftWidth: 1 }
                : { flex: 1 }),
              borderColor: theme.colors.border,
              minHeight: 0,
              minWidth: 0,
            }}
          >
            <FileTree
              key={recordId}
              files={summary.files}
              index={index}
              theme={theme}
              onSelect={(next) => {
                setIndex(next);
                setFileListOpen(false);
              }}
            />
          </View>
        )}
      </View>
    </View>
  );
}
