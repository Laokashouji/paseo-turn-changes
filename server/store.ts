import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  nativeStatusSchema,
  settingsSchema,
  summarySchema,
  type Settings,
  type Summary,
} from "../shared/contracts";

const snapshotSchema = z.object({ text: z.string(), mode: z.number().int() });
export const recordSchema = summarySchema.extend({
  version: z.literal(1),
  cwd: z.string(),
  turnId: z.string().nullable(),
  timeline: z.object({ epoch: z.string(), maxSeq: z.number().int().nonnegative() }).optional(),
  files: z.array(
    summarySchema.shape.files.element.extend({
      patch: z.string(),
      content: z.string().optional(),
      before: snapshotSchema.nullable(),
      after: snapshotSchema.nullable(),
    }),
  ),
});
export type Record = z.infer<typeof recordSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;

export function summarize(record: Record): Summary {
  return summarySchema.parse({
    ...record,
    files: record.files.map((file) => ({
      ...file,
      path: path.resolve(record.cwd, file.path),
      previousPath: file.previousPath === null ? null : path.resolve(record.cwd, file.previousPath),
    })),
  });
}

export class Store {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(readonly directory: string) {}

  async exclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.pending.set(key, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(key) === next) this.pending.delete(key);
    }
  }

  async readSettings(): Promise<{ revision: string; values: Settings }> {
    let text: string;
    try {
      text = await readFile(path.join(this.directory, "settings.json"), "utf8");
    } catch (error) {
      if (!isMissing(error)) throw error;
      return { revision: "initial", values: settingsSchema.parse({}) };
    }
    return { revision: digest(text), values: settingsSchema.parse(JSON.parse(text)) };
  }

  async saveSettings(revision: string, values: Settings) {
    return this.exclusive("settings", async () => {
      const current = await this.readSettings();
      if (revision !== current.revision) throw new Error("设置已在另一处修改，请刷新后重新保存。");
      const text = JSON.stringify(settingsSchema.parse(values), null, 2);
      await this.atomicWrite("settings.json", text);
      return { revision: digest(text), values: settingsSchema.parse(values) };
    });
  }

  async save(record: Record): Promise<void> {
    const valid = recordSchema.parse(record);
    await this.atomicWrite(`records/${valid.id}.json`, JSON.stringify(valid));
  }

  async nativeStatus(): Promise<z.infer<typeof nativeStatusSchema>> {
    try {
      return nativeStatusSchema.parse(
        JSON.parse(await readFile(path.join(this.directory, "native-status.json"), "utf8")),
      );
    } catch (error) {
      if (isMissing(error)) return {};
      throw error;
    }
  }

  async observeNative(provider: string, available: boolean) {
    await this.exclusive("native-status", async () => {
      const current = await this.nativeStatus();
      await this.atomicWrite(
        "native-status.json",
        JSON.stringify({
          ...current,
          [provider]: { available, observedAt: new Date().toISOString() },
        }),
      );
    });
  }

  async get(id: string, agentId: string): Promise<Record> {
    z.string().uuid().parse(id);
    const record = recordSchema.parse(
      JSON.parse(await readFile(path.join(this.directory, "records", `${id}.json`), "utf8")),
    );
    if (record.agentId !== agentId) throw new Error("这条改动记录不属于当前对话。");
    return record;
  }

  async list(agentId: string): Promise<Record[]> {
    let names: string[];
    try {
      names = await readdir(path.join(this.directory, "records"));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const records: Record[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const record = recordSchema.parse(
        JSON.parse(await readFile(path.join(this.directory, "records", name), "utf8")),
      );
      if (record.agentId === agentId) records.push(record);
    }
    return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private async atomicWrite(name: string, contents: string) {
    const target = path.join(this.directory, name);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch((error) => {
        if (!isMissing(error)) throw error;
      });
    }
  }
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
