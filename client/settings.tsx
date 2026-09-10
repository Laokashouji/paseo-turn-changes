import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsInput,
} from "@getpaseo/plugin/client/ui";
import { readSettings, saveSettings, type Settings, type Source } from "../shared/contracts";
import { Action } from "./card";

const options: { label: string; value: Source }[] = [
  { label: "原生本轮差异", value: "native" },
  { label: "插件汇总编辑", value: "edits" },
];

export function SourcesSettings({ theme, host }: PluginSurfaceProps) {
  const read = useRpc(readSettings);
  const save = useRpc(saveSettings);
  const queries = useQueryClient();
  const key = [host.id, "turn-changes-settings"];
  const query = useQuery({ queryKey: key, queryFn: () => read({}) });
  const [provider, setProvider] = useState("");
  const mutation = useMutation({
    mutationFn: (values: Settings) => {
      if (!query.data) throw new Error("设置尚未读取完成。");
      return save({ revision: query.data.revision, values });
    },
    onSuccess: (value) => queries.setQueryData(key, value),
  });
  if (query.isPending)
    return <Text style={{ color: theme.colors.foregroundMuted }}>正在读取设置…</Text>;
  if (query.isError)
    return (
      <View style={{ gap: 12 }}>
        <Text style={{ color: theme.colors.statusDanger }}>{query.error.message}</Text>
        <Action theme={theme} label="重新读取" onPress={() => void query.refetch()} />
      </View>
    );
  const values = query.data.values;
  return (
    <View style={{ gap: 20 }} testID="turn-changes-settings">
      <Text style={{ color: theme.colors.foregroundMuted }}>
        为不同执行后端选择差异来源。修改从下一轮开始生效，历史改动记录保持原样。
      </Text>
      <SettingsSection title="数据来源">
        <SettingsCard>
          {Object.entries(values.providers).map(([id, source]) => (
            <SettingsSelect
              key={id}
              label={id}
              value={source}
              options={options}
              disabled={mutation.isPending}
              onValueChange={(next) =>
                mutation.mutate({ ...values, providers: { ...values.providers, [id]: next } })
              }
            />
          ))}
          <SettingsSelect
            label="其他执行后端"
            value={values.defaultSource}
            options={options}
            disabled={mutation.isPending}
            onValueChange={(defaultSource) => mutation.mutate({ ...values, defaultSource })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="添加单独配置">
        <SettingsCard>
          <SettingsInput
            label="执行后端编号"
            placeholder="例如 claude 或 claude-super-relay"
            onChangeText={setProvider}
            disabled={mutation.isPending}
          />
        </SettingsCard>
        <Action
          theme={theme}
          label="添加配置"
          disabled={
            mutation.isPending || !provider.trim() || Boolean(values.providers[provider.trim()])
          }
          onPress={() =>
            mutation.mutate({
              ...values,
              providers: { ...values.providers, [provider.trim()]: values.defaultSource },
            })
          }
        />
      </SettingsSection>
      {mutation.isPending && <Text style={{ color: theme.colors.foregroundMuted }}>正在保存…</Text>}
      {mutation.isSuccess && (
        <Text style={{ color: theme.colors.statusSuccess }}>设置已保存，下轮生效。</Text>
      )}
      {mutation.isError && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.colors.statusDanger }}>{mutation.error.message}</Text>
          <Action
            theme={theme}
            label="刷新设置"
            onPress={() => {
              mutation.reset();
              void query.refetch();
            }}
          />
        </View>
      )}
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        原生差异需要 Paseo
        提供相应数据。数据不可用时会明确提示，不会自动改用插件汇总。插件汇总只覆盖执行后端提供的文件编辑记录。
      </Text>
    </View>
  );
}
