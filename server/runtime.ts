import { homedir } from "node:os";
import path from "node:path";
import { realpath } from "node:fs/promises";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  getFile,
  getSummary,
  listChanges,
  readSettings,
  saveSettings,
  undoChanges,
} from "../shared/contracts";
import { Capture } from "./capture";
import { message } from "./differences";
import { Store, summarize } from "./store";
import { turnItems } from "./timeline";
import { undo } from "./undo";

export function contribute(server: PluginServerContext) {
  const home = process.env.PASEO_HOME || path.join(homedir(), ".paseo");
  const store = new Store(
    process.env.PASEO_TURN_CHANGES_HOME || path.join(home, "plugin-data", "turn-changes"),
  );
  const capture = new Capture(store);
  const pending = new Map<string, Promise<unknown>>();
  function enqueue(agentId: string, action: () => Promise<void>) {
    const task = (pending.get(agentId) ?? Promise.resolve()).catch(() => undefined).then(action);
    pending.set(agentId, task);
    void task.catch((error) => console.error("每轮改动记录失败：", message(error)));
    void task
      .finally(() => {
        if (pending.get(agentId) === task) pending.delete(agentId);
      })
      .catch(() => undefined);
    return task;
  }

  server.handle(readSettings, () => store.readSettings());
  server.handle(saveSettings, (input) => store.saveSettings(input.revision, input.values));
  server.handle(getSummary, async (input) =>
    summarize(await store.get(input.recordId, input.agentId)),
  );
  server.handle(getFile, async (input) => {
    const record = await store.get(input.recordId, input.agentId);
    const file = record.files[input.index];
    if (!file) throw new Error("未找到这条文件改动。");
    return {
      path: file.path,
      previousPath: file.previousPath,
      additions: file.additions,
      deletions: file.deletions,
      issue: file.issue,
      patch: file.patch,
    };
  });
  server.handle(listChanges, async (input) =>
    (await store.list(input.agentId))
      .filter((record) => record.files.length || record.issues.length)
      .map(summarize),
  );
  server.handle(undoChanges, async (input, { paseo }) => {
    const record = await store.get(input.recordId, input.agentId);
    const listing = await paseo.agents.list();
    if (listing.pageInfo.hasMore) throw new Error("无法完整确认正在运行的 Agent，请稍后再试。");
    const root = await realpath(record.cwd);
    for (const { agent } of listing.entries) {
      if (agent.status !== "running" && agent.status !== "initializing") continue;
      const activeRoot = await realpath(agent.cwd);
      const relative = path.relative(root, activeRoot);
      const reverse = path.relative(activeRoot, root);
      const contained = (value: string) =>
        value === "" ||
        (!value.startsWith(`..${path.sep}`) && value !== ".." && !path.isAbsolute(value));
      if (contained(relative) || contained(reverse))
        throw new Error("这个工作目录仍有 Agent 正在运行，请等待结束后再撤销。");
    }
    return summarize(await undo(store, input.recordId, input.agentId));
  });
  server.on("agent.turn_started", (event) => enqueue(event.agent.id, () => capture.start(event)));
  server.on("agent.turn_ended", (event, { paseo }) =>
    enqueue(event.agent.id, async () => {
      let items: unknown[] = [];
      let issue: string | undefined;
      let timeline: Awaited<ReturnType<typeof turnItems>>["timeline"] | undefined;
      try {
        const previous = (await store.list(event.agent.id)).find(
          (record) => record.finishedAt && record.timeline,
        );
        const loaded = await turnItems(paseo, event.agent.id, event.turnId, previous?.timeline);
        items = loaded.items;
        timeline = loaded.timeline;
      } catch (error) {
        issue = message(error);
      }
      const record = await store.exclusive(`cwd:${event.agent.cwd}`, () =>
        capture.finish(event, items, issue, timeline),
      );
      if (record.files.length === 0 && record.issues.length === 0) return;
      await paseo.agents.ref(event.agent.id).timeline.append({
        type: "plugin",
        id: record.id,
        kind: "turn-changes",
        version: 1,
        data: { recordId: record.id },
      });
    }),
  );
  return async () => {
    await Promise.allSettled(pending.values());
  };
}
