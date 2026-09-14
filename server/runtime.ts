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
  getNativeStatus,
  getSource,
  saveSource,
} from "../shared/contracts";
import { Capture } from "./capture";
import { message } from "./differences";
import { Store, summarize } from "./store";
import { turnItems } from "./timeline";
import { undo } from "./undo";
import { reviewRecord } from "./review";
import { readCodexRecordedItems } from "./codex-records";
import { resolveSource, readSource, writeSource } from "./source";

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
  server.handle(getNativeStatus, () => store.nativeStatus());
  server.handle(saveSettings, (input) => store.saveSettings(input.revision, input.values));
  async function enrich(items: unknown[], agentId: string, paseo: Parameters<typeof turnItems>[0]) {
    try {
      const current = await paseo.agents.ref(agentId).refresh();
      const persistence = current?.agent.persistence;
      return current?.agent.provider === "codex" && persistence?.sessionId
        ? await readCodexRecordedItems(items, persistence.sessionId, current.agent.cwd)
        : items;
    } catch {
      return items;
    }
  }
  async function forReview(
    record: Awaited<ReturnType<Store["get"]>>,
    paseo: Parameters<typeof turnItems>[0],
  ) {
    if (record.timeline && record.files.some((file) => !file.patch)) {
      try {
        const loaded = await turnItems(paseo, record.agentId, record.turnId);
        if (
          loaded.timeline.epoch === record.timeline.epoch &&
          loaded.timeline.maxSeq === record.timeline.maxSeq
        )
          return reviewRecord(record, await enrich(loaded.items, record.agentId, paseo));
      } catch {
        /* Stored evidence is still available after a timeline is archived or replaced. */
      }
    }
    return reviewRecord(record);
  }
  server.handle(getSummary, async (input, { paseo }) =>
    summarize(await forReview(await store.get(input.recordId, input.agentId), paseo)),
  );
  server.handle(getFile, async (input, { paseo }) => {
    const record = await forReview(await store.get(input.recordId, input.agentId), paseo);
    const file = record.files[input.index];
    if (!file) throw new Error("未找到这条文件改动。");
    return {
      path: file.path,
      previousPath: file.previousPath,
      additions: file.additions,
      deletions: file.deletions,
      issue: file.issue,
      patch: file.patch,
      content: file.content,
      reviewKind: file.reviewKind,
    };
  });
  async function sourceFor(input: { recordId: string; agentId: string; index: number }) {
    const record = await store.get(input.recordId, input.agentId);
    const file = record.files[input.index];
    if (!file) throw new Error("未找到这条文件改动。");
    return resolveSource(record.cwd, file.path, home);
  }
  server.handle(getSource, async (input) => readSource(await sourceFor(input)));
  server.handle(saveSource, async (input) => {
    const source = await sourceFor(input);
    return store.exclusive(`source:${source.absolutePath}`, () => writeSource(source, input));
  });
  server.handle(listChanges, async (input) =>
    (await store.list(input.agentId))
      .filter((record) => record.files.length || record.issues.length)
      .map((record) => summarize(reviewRecord(record))),
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
        items = await enrich(loaded.items, event.agent.id, paseo);
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
