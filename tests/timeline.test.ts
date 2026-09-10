import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaseoApi } from "@getpaseo/client";
import { turnItems } from "../server/timeline";

function entry(turnId: string, seqEnd: number, callId = String(seqEnd), status = "completed") {
  return { turnId, seqEnd, item: { type: "tool_call", callId, status } };
}
function mock(pages: object[]) {
  let calls = 0;
  const paseo = {
    agents: {
      ref: () => ({
        timeline: {
          refetch: async () => {
            const page = pages[calls++];
            assert.ok(page, "unexpected extra page");
            return {
              epoch: "epoch",
              hasOlder: false,
              error: null,
              gap: false,
              staleCursor: false,
              ...page,
            };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  return { paseo, count: () => calls };
}

test("跨页选取本轮最终编辑，不混入前后轮次", async () => {
  const { paseo, count } = mock([
    {
      entries: [entry("this", 8, "edit"), entry("next", 9)],
      hasOlder: true,
      startCursor: "page-1",
    },
    {
      entries: [
        entry("older", 3),
        entry("this", 4, "another"),
        entry("this", 5, "edit", "running"),
      ],
    },
  ]);
  const result = await turnItems(paseo, "agent", "this");
  assert.deepEqual(result.items, [entry("this", 4, "another").item, entry("this", 8, "edit").item]);
  assert.deepEqual(result.timeline, { epoch: "epoch", maxSeq: 8 });
  assert.equal(count(), 2);
});

test("轮次编号复用时以上轮序号为边界；分页缺口明确失败", async () => {
  const { paseo } = mock([{ entries: [entry("same", 2), entry("same", 6)] }]);
  const result = await turnItems(paseo, "agent", "same", { epoch: "epoch", maxSeq: 4 });
  assert.deepEqual(result.items, [entry("same", 6).item]);
  await assert.rejects(
    turnItems(mock([{ entries: [], gap: true }]).paseo, "agent", "same"),
    /不完整/,
  );
  await assert.rejects(
    turnItems(mock([{ entries: [entry("other", 2)] }]).paseo, "agent", "missing"),
    /未找到/,
  );
});
