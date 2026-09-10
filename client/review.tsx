import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc, type PluginHostProps } from "@getpaseo/plugin/client";
import { FlatList } from "@getpaseo/plugin/client/react-native";
import { getFile, type Summary } from "../shared/contracts";
import { Action } from "./card";

export function Review(
  props: PluginHostProps & {
    agentId: string;
    recordId: string;
    summary: Summary;
    index: number;
    setIndex: (index: number) => void;
  },
) {
  const { theme, host, layout, agentId, recordId, summary, index, setIndex } = props;
  const read = useRpc(getFile);
  const query = useQuery({
    queryKey: [host.id, "turn-file", agentId, recordId, index],
    queryFn: () => read({ agentId, recordId, index }),
  });
  return (
    <View style={{ height: layout.compact ? 430 : 600, backgroundColor: theme.colors.surface0 }}>
      <View
        style={{ padding: 12, gap: 10, borderBottomWidth: 1, borderColor: theme.colors.border }}
      >
        <Text selectable style={{ color: theme.colors.foreground, fontSize: 13 }}>
          {summary.files[index]?.path}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
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
      {query.data && (
        <FlatList
          style={{ flex: 1 }}
          data={query.data.patch.split("\n")}
          keyExtractor={(_, line) => String(line)}
          renderItem={({ item: line }) => {
            let color = theme.colors.foreground;
            if (line.startsWith("+") && !line.startsWith("+++")) color = theme.colors.statusSuccess;
            if (line.startsWith("-") && !line.startsWith("---")) color = theme.colors.statusDanger;
            if (line.startsWith("@@")) color = theme.colors.accent;
            return (
              <Text
                selectable
                style={{
                  color,
                  fontFamily: layout.platform === "ios" ? "Menlo" : "monospace",
                  fontSize: 12,
                  lineHeight: 20,
                  paddingHorizontal: 12,
                }}
              >
                {line || " "}
              </Text>
            );
          }}
        />
      )}
    </View>
  );
}
