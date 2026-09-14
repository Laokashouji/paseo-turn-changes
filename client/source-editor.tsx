import { useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useRpc, type PluginHostProps } from "@getpaseo/plugin/client";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { saveSource, type SourceDocument } from "../shared/contracts";
import { Action } from "./card";

export function SourceEditor(
  props: PluginHostProps & {
    agentId: string;
    recordId: string;
    index: number;
    document: SourceDocument;
    fill?: boolean;
    onClose: () => void;
  },
) {
  const { theme, layout } = props;
  const { height } = useWindowDimensions();
  const [saved, setSaved] = useState(props.document);
  const [draft, setDraft] = useState(props.document.content);
  const [confirmClose, setConfirmClose] = useState(false);
  const dirty = draft !== saved.content;
  const save = useRpc(saveSource);
  const mutation = useMutation({
    mutationFn: () =>
      save({
        agentId: props.agentId,
        recordId: props.recordId,
        index: props.index,
        absolutePath: saved.absolutePath,
        revision: saved.revision,
        content: draft,
      }),
    onSuccess: (value) => {
      setSaved(value);
      setDraft(value.content);
      setConfirmClose(false);
    },
  });
  return (
    <View
      testID="turn-source-editor"
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Action
            theme={theme}
            label="返回差异"
            disabled={mutation.isPending}
            onPress={() => (dirty ? setConfirmClose(true) : props.onClose())}
          />
          <Text style={{ color: theme.colors.foregroundMuted, flex: 1, fontSize: 12 }}>
            {dirty ? "未保存" : mutation.isSuccess ? "已保存" : "源文件"}
          </Text>
          <Action
            theme={theme}
            label={mutation.isPending ? "保存中…" : "保存"}
            disabled={!dirty || mutation.isPending}
            onPress={() => mutation.mutate()}
          />
        </View>
        <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {saved.absolutePath}
        </Text>
        {mutation.isError && (
          <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
            {mutation.error.message}
          </Text>
        )}
        {confirmClose && (
          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.colors.foreground }}>还有未保存的修改。</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Action theme={theme} label="继续编辑" onPress={() => setConfirmClose(false)} />
              <Action theme={theme} label="放弃修改并返回" onPress={props.onClose} />
            </View>
          </View>
        )}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          testID="turn-source-input"
          accessibilityLabel={`编辑源文件 ${saved.path}`}
          multiline
          value={draft}
          onChangeText={setDraft}
          editable={!mutation.isPending}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textAlignVertical="top"
          style={{
            flex: 1,
            padding: 12,
            color: theme.colors.foreground,
            backgroundColor: theme.colors.surface0,
            fontFamily: layout.platform === "ios" ? "Menlo" : "monospace",
            fontSize: 13,
            lineHeight: 22,
          }}
        />
      </ScrollView>
    </View>
  );
}
