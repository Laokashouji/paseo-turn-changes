import { useContext, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useRpc,
  useAgent,
  type PluginHostProps,
  type PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { getSummary, undoChanges, type Summary } from "../shared/contracts";
import { Review } from "./review";
import { ReviewNavigation } from "./review-navigation";
import { setHoverHint } from "./web";
import { undoHint } from "../shared/undo-hint";

export function TurnCard(props: PluginTimelineItemProps<{ recordId: string }>) {
  const workspaceId = useAgent(props.agentId, (agent) => agent.workspaceId);
  return (
    <RecordCard
      {...props}
      workspaceId={workspaceId ?? undefined}
      recordId={props.item.data.recordId}
    />
  );
}

export function RecordCard(
  props: PluginHostProps & { agentId: string; recordId: string; workspaceId?: string },
) {
  const { theme, host, agentId, recordId } = props;
  const read = useRpc(getSummary);
  const query = useQuery({
    queryKey: [host.id, "turn", agentId, recordId],
    queryFn: () => read({ agentId, recordId }),
  });
  if (query.isPending)
    return (
      <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>正在读取本轮改动…</Text>
    );
  if (query.isError)
    return (
      <View style={{ padding: 16, gap: 8 }}>
        <Text style={{ color: theme.colors.statusDanger }}>{query.error.message}</Text>
        <Action theme={theme} label="重试" onPress={() => void query.refetch()} />
      </View>
    );
  return <CardBody {...props} summary={query.data} />;
}

function CardBody(
  props: PluginHostProps & {
    agentId: string;
    recordId: string;
    summary: Summary;
    workspaceId?: string;
  },
) {
  const { theme, layout, host, agentId, recordId, summary } = props;
  const colors = theme.colors;
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const navigation = useContext(ReviewNavigation);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  function openReview(index: number) {
    setNavigationError(null);
    if (layout.compact || !navigation || !props.workspaceId) {
      setReviewIndex(index);
      return;
    }
    try {
      navigation.open(props.workspaceId, agentId, { recordId, index });
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : String(error));
    }
  }
  const undo = useRpc(undoChanges);
  const queries = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => undo({ agentId, recordId }),
    onSuccess: (value) => {
      queries.setQueryData([host.id, "turn", agentId, recordId], value);
      void queries.invalidateQueries({ queryKey: [host.id, "turn-list", agentId] });
      setConfirmUndo(false);
    },
  });
  const known = summary.files.every((file) => file.additions !== null && file.deletions !== null);
  const additions = summary.files.reduce((count, file) => count + (file.additions ?? 0), 0);
  const deletions = summary.files.reduce((count, file) => count + (file.deletions ?? 0), 0);
  const visible = showAll ? summary.files : summary.files.slice(0, 6);
  const status = [
    summary.outcome === "failed" ? "本轮执行失败" : "",
    summary.outcome === "canceled" ? "本轮已中断" : "",
    summary.undoneAt ? "已撤销" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View
      testID="turn-changes-card"
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: colors.surface1,
        overflow: "hidden",
        marginVertical: 12,
      }}
    >
      <View style={{ padding: layout.compact ? 12 : 18, gap: 12 }}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <View
            style={{
              width: 40,
              height: 44,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.surface0,
            }}
          >
            <Icon name="FileDiff" size={24} color={colors.foregroundMuted} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>
              {summary.finishedAt === ""
                ? "正在记录本轮改动"
                : summary.files.length
                  ? `已编辑 ${summary.files.length} 个文件`
                  : "本轮改动未完整记录"}
            </Text>
            {known && summary.files.length > 0 ? (
              <Counts theme={theme} additions={additions} deletions={deletions} />
            ) : !summary.finishedAt ? (
              <Text
                style={{
                  color: colors.foregroundMuted,
                  fontSize: 12,
                }}
              >
                轮次结束后生成文件列表
              </Text>
            ) : null}
          </View>
          {!layout.compact && (
            <Actions
              theme={theme}
              summary={summary}
              undo={() => setConfirmUndo(true)}
              review={() => openReview(0)}
            />
          )}
        </View>
        {layout.compact && (
          <Actions
            theme={theme}
            summary={summary}
            undo={() => setConfirmUndo(true)}
            review={() => openReview(0)}
          />
        )}
        {status ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{status}</Text>
        ) : null}
        {navigationError && <Text style={{ color: colors.statusDanger }}>{navigationError}</Text>}
      </View>
      {visible.map((file, index) => (
        <Pressable
          key={file.path}
          accessibilityRole="button"
          accessibilityLabel={`查看 ${file.path} 的本轮差异`}
          onPress={() => openReview(index)}
          style={{
            borderTopWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: layout.compact ? 12 : 18,
            paddingVertical: 12,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Text
              numberOfLines={1}
              ellipsizeMode="middle"
              style={{ color: colors.foreground, fontSize: 13, flex: 1 }}
            >
              {file.path}
            </Text>
            {file.additions !== null && file.deletions !== null && (
              <Counts theme={theme} additions={file.additions} deletions={file.deletions} />
            )}
          </View>
        </Pressable>
      ))}
      {summary.files.length > 6 && (
        <View style={{ padding: 12 }}>
          <Action
            theme={theme}
            label={showAll ? "收起文件列表" : `查看全部 ${summary.files.length} 个文件`}
            onPress={() => setShowAll(!showAll)}
          />
        </View>
      )}
      <Modal
        title="本轮代码差异"
        open={reviewIndex !== null}
        onOpenChange={(open) => {
          if (!open) setReviewIndex(null);
        }}
      >
        <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}>
          {reviewIndex !== null && (
            <Review {...props} index={reviewIndex} setIndex={setReviewIndex} />
          )}
        </Modal.Content>
      </Modal>
      <Modal
        title="撤销本轮文件改动"
        open={confirmUndo}
        onOpenChange={(open) => {
          if (!mutation.isPending) setConfirmUndo(open);
        }}
      >
        <Modal.Content>
          <Text style={{ color: colors.foreground }}>
            将恢复这 {summary.files.length} 个文件在本轮之前的内容。若文件已有后续修改，撤销会停止。
          </Text>
          {mutation.isError && (
            <Text style={{ color: colors.statusDanger }}>{mutation.error.message}</Text>
          )}
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Action
              theme={theme}
              label="取消"
              disabled={mutation.isPending}
              onPress={() => setConfirmUndo(false)}
            />
            <Action
              theme={theme}
              label={mutation.isPending ? "正在撤销…" : "确认撤销"}
              disabled={mutation.isPending}
              onPress={() => mutation.mutate()}
            />
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}

function Actions({
  theme,
  summary,
  undo,
  review,
}: {
  theme: PluginHostProps["theme"];
  summary: Summary;
  undo: () => void;
  review: () => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
      <Action
        theme={theme}
        label={summary.undoneAt ? "已撤销" : "撤销"}
        disabled={!summary.canUndo}
        hint={undoHint(summary)}
        onPress={undo}
      />
      <Action theme={theme} label="审核" disabled={summary.files.length === 0} onPress={review} />
    </View>
  );
}

export function Action({
  theme,
  label,
  onPress,
  disabled = false,
  hint,
}: {
  theme: PluginHostProps["theme"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <View ref={(node) => setHoverHint(node, disabled ? hint : undefined)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        accessibilityHint={disabled ? hint : undefined}
        onPress={onPress}
        disabled={disabled}
        style={{
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{label}</Text>
      </Pressable>
    </View>
  );
}

export function Counts({
  theme,
  additions,
  deletions,
}: {
  theme: PluginHostProps["theme"];
  additions: number;
  deletions: number;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      <Text style={{ color: theme.colors.statusSuccess, fontSize: 13 }}>+{additions}</Text>
      <Text style={{ color: theme.colors.statusDanger, fontSize: 13 }}>−{deletions}</Text>
    </View>
  );
}
