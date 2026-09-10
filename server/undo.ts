import { randomUUID } from "node:crypto";
import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { checkedPath, sameSnapshot, snapshot } from "./files";
import { message } from "./differences";
import { isMissing, Store, type Record, type Snapshot } from "./store";

export async function undo(store: Store, id: string, agentId: string): Promise<Record> {
  const initial = await store.get(id, agentId);
  return store.exclusive(`cwd:${initial.cwd}`, async () => {
    const record = await store.get(id, agentId);
    if (record.undoneAt) return record;
    if (!record.canUndo || record.undoState !== "ready")
      throw new Error("这轮改动没有完整的可撤销数据。");
    for (const file of record.files) {
      const current = await snapshot(record.cwd, file.path);
      if (!sameSnapshot(current, file.after))
        throw new Error(`${file.path} 已有后续修改，未撤销任何文件。`);
    }
    const applying: Record = { ...record, canUndo: false, undoState: "applying" };
    await store.save(applying);
    const restored: Record["files"] = [];
    try {
      for (const file of record.files) {
        if (!sameSnapshot(await snapshot(record.cwd, file.path), file.after))
          throw new Error(`${file.path} 在撤销期间发生变化。`);
        await replaceFile(record.cwd, file.path, file.before);
        restored.push(file);
      }
      for (const file of record.files) {
        if (!sameSnapshot(await snapshot(record.cwd, file.path), file.before))
          throw new Error(`${file.path} 撤销后的内容校验失败。`);
      }
      const done: Record = { ...applying, undoState: "done", undoneAt: new Date().toISOString() };
      await store.save(done);
      return done;
    } catch (error) {
      const failures: string[] = [];
      for (const file of restored.reverse()) {
        try {
          if (!sameSnapshot(await snapshot(record.cwd, file.path), file.before))
            throw new Error("文件再次变化，保留现状");
          await replaceFile(record.cwd, file.path, file.after);
        } catch (recoveryError) {
          failures.push(`${file.path}：${message(recoveryError)}`);
        }
      }
      if (failures.length) {
        await store.save({
          ...applying,
          undoState: "failed",
          issues: [...record.issues, `撤销未完成：${failures.join("；")}`],
        });
        throw new Error(`撤销未完成，需检查以下文件：${failures.join("；")}`);
      }
      await store.save(record);
      throw new Error(`撤销失败，已恢复撤销前状态：${message(error)}`);
    }
  });
}

async function replaceFile(cwd: string, name: string, value: Snapshot | null) {
  const target = await checkedPath(cwd, name);
  if (value === null) {
    await unlink(target);
    return;
  }
  const temporary = `${target}.paseo-undo-${randomUUID()}`;
  try {
    await writeFile(temporary, value.text, { flag: "wx", mode: value.mode });
    await chmod(temporary, value.mode);
    await checkedPath(cwd, name);
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error) => {
      if (!isMissing(error)) throw error;
    });
  }
}
