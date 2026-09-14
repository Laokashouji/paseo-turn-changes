import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const sourceSchema = z.enum(["native", "edits"]);
export type Source = z.infer<typeof sourceSchema>;
export const sourceModeSchema = z.enum(["auto", "native", "edits"]);
export type SourceMode = z.infer<typeof sourceModeSchema>;
export const settingsSchema = z.object({
  defaultSource: sourceModeSchema.default("edits"),
  providers: z.record(z.string().min(1).max(120), sourceModeSchema).default({ codex: "auto" }),
});
export type Settings = z.infer<typeof settingsSchema>;
export function sourceFor(settings: Settings, provider: string): SourceMode {
  return Object.hasOwn(settings.providers, provider)
    ? settings.providers[provider]
    : settings.defaultSource;
}

export const fileSummarySchema = z.object({
  path: z.string(),
  previousPath: z.string().nullable(),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  issue: z.string().nullable(),
  reviewKind: z.enum(["net", "edits", "content", "unavailable"]).optional(),
});
export const summarySchema = z.object({
  id: z.string().uuid(),
  agentId: z.string(),
  provider: z.string(),
  source: sourceSchema,
  requestedSource: sourceModeSchema.optional(),
  startedAt: z.string(),
  finishedAt: z.string(),
  outcome: z.enum(["completed", "failed", "canceled", "incomplete"]),
  issues: z.array(z.string()),
  files: z.array(fileSummarySchema),
  canUndo: z.boolean(),
  undoneAt: z.string().nullable(),
  undoState: z.enum(["ready", "applying", "failed", "done"]).default("ready"),
});
export type Summary = z.infer<typeof summarySchema>;
export const cardSchema = z.object({ recordId: z.string().uuid() });
const recordInput = z.object({ recordId: z.string().uuid(), agentId: z.string() });
const settingsDocument = z.object({ revision: z.string(), values: settingsSchema });

export const nativeStatusSchema = z.record(
  z.string(),
  z.object({
    available: z.boolean(),
    observedAt: z.string(),
  }),
);
export const getNativeStatus = defineRpc({
  name: "sources.native-status",
  input: z.object({}),
  output: nativeStatusSchema,
});

export const readSettings = defineRpc({
  name: "sources.read",
  input: z.object({}),
  output: settingsDocument,
});
export const saveSettings = defineRpc({
  name: "sources.save",
  input: settingsDocument,
  output: settingsDocument,
});
export const getSummary = defineRpc({
  name: "changes.read",
  input: recordInput,
  output: summarySchema,
});
export const getFile = defineRpc({
  name: "changes.file",
  input: recordInput.extend({ index: z.number().int().nonnegative() }),
  output: fileSummarySchema.extend({ patch: z.string(), content: z.string().optional() }),
});
export const sourceDocumentSchema = z.object({
  path: z.string(),
  absolutePath: z.string(),
  content: z.string(),
  revision: z.string(),
});
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export const getSource = defineRpc({
  name: "changes.source",
  input: recordInput.extend({ index: z.number().int().nonnegative() }),
  output: sourceDocumentSchema,
});
export const saveSource = defineRpc({
  name: "changes.source.save",
  input: recordInput.extend({
    index: z.number().int().nonnegative(),
    absolutePath: z.string(),
    revision: z.string(),
    content: z.string().max(1024 * 1024),
  }),
  output: sourceDocumentSchema,
});
export const undoChanges = defineRpc({
  name: "changes.undo",
  input: recordInput,
  output: summarySchema,
});
export const listChanges = defineRpc({
  name: "changes.list",
  input: z.object({ agentId: z.string() }),
  output: z.array(summarySchema),
});
