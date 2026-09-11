import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createTwoFilesPatch } from "diff";

const source = path.resolve(process.argv[2] || "../paseo-turn-diff-host");
const plugin = path.resolve(
  process.env.PASEO_TEST_PLUGIN_ROOT || path.join(import.meta.dirname, ".."),
);
const load = (name) => import(pathToFileURL(path.join(source, name)).href);
const { createTestPaseoDaemon } = await load(
  "packages/server/src/server/test-utils/paseo-daemon.ts",
);
const { createTestAgentClient } = await load(
  "packages/server/src/server/test-utils/fake-agent-client.ts",
);
const { DaemonClient } = await load("packages/server/src/server/test-utils/daemon-client.ts");
const root = await mkdtemp(path.join(tmpdir(), "paseo-turn-smoke-"));
const originalStorage = process.env.PASEO_TURN_CHANGES_HOME;
process.env.PASEO_TURN_CHANGES_HOME = path.join(root, "plugin-data");

function provider(name) {
  const client = createTestAgentClient(name);
  const create = client.createSession.bind(client);
  client.createSession = async (config, ...args) => {
    const session = await create(config, ...args);
    const subscribe = session.subscribe.bind(session);
    let number = 0;
    session.subscribe = (callback) =>
      subscribe((event) => {
        if (event.type !== "turn_completed") {
          callback(event);
          return;
        }
        number++;
        const file = path.join(config.cwd, "file.txt");
        const before = readFileSync(file, "utf8");
        const after = `new ${number}\n`;
        const diff = createTwoFilesPatch("file.txt", "file.txt", before, after);
        writeFileSync(file, after);
        callback({
          type: "timeline",
          provider: name,
          turnId: event.turnId,
          item: {
            type: "tool_call",
            callId: `edit-${number}`,
            name: "Edit",
            status: "completed",
            error: null,
            detail: { type: "edit", filePath: file, unifiedDiff: diff },
          },
        });
        callback(name === "codex" ? { ...event, nativeDiff: diff } : event);
      });
    return session;
  };
  return client;
}

async function eventually(action, predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await action();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for plugin result");
}

let daemon;
let client;
try {
  daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    agentClients: { codex: provider("codex"), claude: provider("claude") },
  });
  const terminalEvents = [];
  daemon.daemon.agentManager.subscribe(
    (event) => {
      if (event.type === "agent_stream" && event.event.type === "turn_completed")
        terminalEvents.push(event.event);
    },
    { replayState: false },
  );
  client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.8.0",
  });
  await client.connect();
  await client.fetchAgents({ subscribe: { subscriptionId: "turn-changes-smoke" } });
  await client.patchDaemonConfig({ pluginsEnabled: true });
  const installed = await client.installDirectoryPlugin(plugin);
  console.log("plugin installation:", JSON.stringify(installed));
  const rpc = (method, input) => client.invokePluginRpc("turn-changes", method, input);
  assert.deepEqual(await rpc("sources.native-status", {}), {});
  const config = await rpc("sources.read", {});
  assert.equal(config.values.providers.codex, "native");
  assert.equal(config.values.defaultSource, "edits");
  const saved = await rpc("sources.save", { revision: config.revision, values: config.values });
  await assert.rejects(
    rpc("sources.save", { revision: config.revision, values: config.values }),
    /另一处修改/,
  );
  const evidence = [];
  for (const name of ["codex", "claude"]) {
    const cwd = path.join(root, name);
    await mkdir(cwd);
    await writeFile(path.join(cwd, "file.txt"), "old\n");
    const agent = await client.createAgent({
      provider: name,
      cwd,
      title: "Turn changes fixture",
      modeId: "full-access",
    });
    await client.sendMessage(agent.id, "Produce the scripted test turn");
    const records = await eventually(
      () => rpc("changes.list", { agentId: agent.id }),
      (value) => value.some((record) => record.finishedAt),
    );
    const record = records.find((value) => value.finishedAt);
    assert.equal(record.source, name === "codex" ? "native" : "edits");
    assert.equal(record.canUndo, true, JSON.stringify(record));
    assert.equal((await rpc("sources.native-status", {}))[name].available, name === "codex");
    assert.deepEqual(
      record.files.map((file) => [file.path, file.additions, file.deletions]),
      [["file.txt", 1, 1]],
    );
    const input = { recordId: record.id, agentId: agent.id };
    const file = await rpc("changes.file", { ...input, index: 0 });
    assert.match(file.patch, /-old\n\+new 1/);
    const timeline = await eventually(
      () => client.fetchAgentTimeline(agent.id, { projection: "canonical" }),
      (value) => value.entries.some((entry) => entry.item.type === "plugin"),
    );
    assert.equal(timeline.entries.at(-1).item.kind, "turn-changes");
    await client.reloadPlugin("turn-changes");
    assert.deepEqual(await rpc("sources.read", {}), saved);
    assert.deepEqual(await rpc("changes.file", { ...input, index: 0 }), file);
    await eventually(
      () => client.fetchAgent(agent.id),
      (value) => value.agent?.status === "idle",
    );
    await client.sendMessage(agent.id, "Produce the second scripted test turn");
    const secondRecords = await eventually(
      () => rpc("changes.list", { agentId: agent.id }),
      (value) => value.filter((record) => record.finishedAt).length === 2,
    );
    const second = secondRecords.find((value) => value.id !== record.id && value.finishedAt);
    assert.equal(second.canUndo, true, JSON.stringify(second));
    const secondInput = { recordId: second.id, agentId: agent.id };
    const secondFile = await rpc("changes.file", { ...secondInput, index: 0 });
    assert.match(secondFile.patch, /-new 1\n\+new 2/);
    assert.deepEqual(await rpc("changes.file", { ...input, index: 0 }), file);
    await eventually(
      () => client.fetchAgent(agent.id),
      (value) => value.agent?.status === "idle",
    );
    await assert.rejects(rpc("changes.undo", input), /后续修改/);
    await rpc("changes.undo", secondInput);
    assert.equal(await readFile(path.join(cwd, "file.txt"), "utf8"), "new 1\n");
    const undone = await rpc("changes.undo", input);
    assert.equal(undone.undoState, "done");
    assert.equal(await readFile(path.join(cwd, "file.txt"), "utf8"), "old\n");
    evidence.push({
      provider: name,
      source: record.source,
      files: 1,
      additions: 1,
      deletions: 1,
      card: true,
      persistedAfterReload: true,
      multipleTurns: true,
      laterEditsProtected: true,
      undo: true,
    });
  }
  assert.equal(terminalEvents.length, 4);
  assert.ok(
    terminalEvents.every((event) => !("nativeDiff" in event)),
    "native diff must not be broadcast to ordinary clients",
  );
  const output = {
    daemonVersion: "0.8.0",
    providerInput: "scripted fixture events",
    results: evidence,
  };
  await mkdir(path.join(plugin, "tmp"), { recursive: true });
  await writeFile(path.join(plugin, "tmp", "daemon-smoke.json"), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
} finally {
  if (client) await client.close();
  if (daemon) await daemon.close();
  if (originalStorage === undefined) delete process.env.PASEO_TURN_CHANGES_HOME;
  else process.env.PASEO_TURN_CHANGES_HOME = originalStorage;
  await rm(root, { recursive: true, force: true });
}
