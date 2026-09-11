import type { PluginHandlerContext } from "@getpaseo/plugin/server";

export async function turnItems(
  paseo: PluginHandlerContext["paseo"],
  agentId: string,
  turnId: string | null,
  previous?: { epoch: string; maxSeq: number },
): Promise<{ items: unknown[]; timeline: { epoch: string; maxSeq: number } }> {
  if (!turnId) throw new Error("执行后端未提供轮次编号，无法可靠划分本轮编辑。");
  const timeline = paseo.agents.ref(agentId).timeline;
  let page = await timeline.refetch({ limit: 200, projection: "canonical" });
  const epoch = page.epoch;
  const minimum = previous?.epoch === epoch ? previous.maxSeq : -1;
  const selected: typeof page.entries = [];
  let found = false;
  for (let count = 0; count < 50; count++) {
    if (page.error || page.gap || page.staleCursor || page.epoch !== epoch)
      throw new Error("对话记录发生变化或不完整，请重新核验本轮改动。");
    let boundary = false;
    for (const entry of [...page.entries].reverse()) {
      if (entry.seqEnd <= minimum) {
        boundary = true;
        break;
      }
      if (entry.turnId === turnId) {
        selected.unshift(entry);
        found = true;
      } else if (found && entry.turnId) {
        boundary = true;
        break;
      }
    }
    if (boundary || !page.hasOlder) {
      if (!found) throw new Error("未找到本轮的完整对话记录。");
      const calls = new Map<string, { seq: number; item: unknown }>();
      for (const entry of selected) {
        if (entry.item.type !== "tool_call") continue;
        const previous = calls.get(entry.item.callId);
        if (!previous || previous.seq <= entry.seqEnd)
          calls.set(entry.item.callId, { seq: entry.seqEnd, item: entry.item });
      }
      const maxSeq = selected.reduce((value, entry) => Math.max(value, entry.seqEnd), 0);
      return {
        items: [...calls.values()].sort((a, b) => a.seq - b.seq).map((value) => value.item),
        timeline: { epoch, maxSeq },
      };
    }
    if (!page.startCursor) throw new Error("对话记录缺少分页位置。");
    page = await timeline.refetch({
      limit: 200,
      projection: "canonical",
      direction: "before",
      cursor: page.startCursor,
    });
  }
  throw new Error("本轮对话记录过长，未取得完整编辑记录。");
}
