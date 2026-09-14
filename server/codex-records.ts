import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { homedir } from "node:os";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { MAX_FILE_BYTES } from "./files";

const providerSchema = z.object({
  extends: z.string().optional(),
  env: z.object({ CODEX_HOME: z.string().optional() }).optional(),
});

export function codexHomeFor(
  provider: string,
  providers: Record<string, unknown>,
  fallback = process.env.CODEX_HOME || path.join(homedir(), ".codex"),
): string | undefined {
  const visited = new Set<string>();
  let home: string | undefined;
  while (!visited.has(provider)) {
    visited.add(provider);
    const parsed = providerSchema.safeParse(
      Object.hasOwn(providers, provider) ? providers[provider] : {},
    );
    if (!parsed.success) return undefined;
    const config = parsed.data;
    // The derived provider's environment overrides its base provider's environment.
    home ??= config?.env?.CODEX_HOME;
    if (provider === "codex")
      return path.isAbsolute(home ?? fallback) ? (home ?? fallback) : undefined;
    if (!config?.extends) return undefined;
    provider = config.extends;
  }
  return undefined;
}

const callSchema = z.object({
  type: z.literal("tool_call"),
  callId: z.string(),
  status: z.literal("completed"),
  detail: z.object({ type: z.literal("edit"), filePath: z.string() }),
});
const eventSchema = z.object({
  type: z.literal("event_msg"),
  payload: z.object({
    type: z.literal("item_completed"),
    thread_id: z.string(),
    item: z.object({
      type: z.literal("FileChange"),
      id: z.string(),
      status: z.literal("completed"),
      changes: z.record(
        z.string(),
        z.object({
          type: z.string(),
          content: z.string().optional(),
          unified_diff: z.string().optional(),
        }),
      ),
    }),
  }),
});

// Match completed call IDs from this turn, not timestamps or text that another turn may reuse.
export function codexRecordedItems(
  items: readonly unknown[],
  events: readonly unknown[],
  sessionId: string,
  cwd = "/",
) {
  const calls = new Map(
    items.flatMap((item) => {
      const parsed = callSchema.safeParse(item);
      return parsed.success ? [[parsed.data.callId, parsed.data] as const] : [];
    }),
  );
  const recovered = new Map<string, unknown[]>();
  for (const event of events) {
    const parsed = eventSchema.safeParse(event);
    if (!parsed.success || parsed.data.payload.thread_id !== sessionId) continue;
    const { item } = parsed.data.payload;
    const call = calls.get(item.id);
    const sameFile = (filePath: string) =>
      call && path.resolve(cwd, filePath) === path.resolve(cwd, call.detail.filePath);
    if (!call || !Object.keys(item.changes).some(sameFile)) continue;
    const edits = Object.entries(item.changes).flatMap(([filePath, change]) => {
      let unifiedDiff: string | undefined;
      if (
        change.type === "add" &&
        change.content !== undefined &&
        Buffer.byteLength(change.content) <= MAX_FILE_BYTES
      )
        unifiedDiff = createTwoFilesPatch("/dev/null", filePath, "", change.content);
      else if (change.type === "update" && change.unified_diff) unifiedDiff = change.unified_diff;
      else if (
        change.type === "delete" &&
        change.content !== undefined &&
        Buffer.byteLength(change.content) <= MAX_FILE_BYTES
      )
        unifiedDiff = createTwoFilesPatch(filePath, "/dev/null", change.content, "");
      return unifiedDiff
        ? [
            {
              ...call,
              callId: `${item.id}:${filePath}`,
              detail: { type: "edit", filePath, unifiedDiff },
            },
          ]
        : [];
    });
    if (edits.some((edit) => sameFile(edit.detail.filePath))) recovered.set(item.id, edits);
  }
  return items.flatMap((item) => {
    const parsed = callSchema.safeParse(item);
    return parsed.success ? (recovered.get(parsed.data.callId) ?? [item]) : [item];
  });
}

export async function readCodexRecordedItems(
  items: readonly unknown[],
  sessionId: string,
  cwd: string,
  codexHome = process.env.CODEX_HOME || path.join(homedir(), ".codex"),
) {
  if (!z.uuid().safeParse(sessionId).success) return [...items];
  const calls = new Set(
    items.flatMap((item) => {
      const parsed = callSchema.safeParse(item);
      return parsed.success ? [parsed.data.callId] : [];
    }),
  );
  if (!calls.size) return [...items];
  try {
    const root = path.join(codexHome, "sessions");
    const names = (await readdir(root, { recursive: true })).filter((name) =>
      name.endsWith(`-${sessionId}.jsonl`),
    );
    if (names.length !== 1) return [...items];
    const input = createReadStream(path.join(root, names[0]), { encoding: "utf8" });
    const lines = createInterface({ input, crlfDelay: Infinity });
    const events: unknown[] = [];
    let verified = false;
    let bytes = 0;
    try {
      for await (const line of lines) {
        bytes += Buffer.byteLength(line);
        if (bytes > 128 * 1024 * 1024) break;
        let row;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        if (row.type === "session_meta") {
          if (row.payload?.id !== sessionId) return [...items];
          verified = true;
        }
        if (verified && row.type === "event_msg" && calls.has(row.payload?.item?.id))
          events.push(row);
      }
    } finally {
      lines.close();
      input.destroy();
    }
    return codexRecordedItems(items, events, sessionId, cwd);
  } catch {
    // Other Codex homes and unavailable native logs retain the canonical evidence.
    return [...items];
  }
}
