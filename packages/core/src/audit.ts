import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getAppDataDirectory } from "./app-settings";

export interface AuditRecord {
  at: string;
  actor: "browser" | "cli";
  action: string;
  target: {
    projectRoot: string;
    requestId?: string;
    threadId?: string;
  };
  detail: string | null;
  outcome: "ok" | "error";
  error?: string;
}

function auditJournalPath(): string {
  return join(getAppDataDirectory(), "audit", "journal.jsonl");
}

export function appendAuditRecord(record: Omit<AuditRecord, "at"> & { at?: string }): AuditRecord {
  const complete: AuditRecord = {
    at: record.at ?? new Date().toISOString(),
    actor: record.actor,
    action: record.action,
    target: record.target,
    detail: record.detail ?? null,
    outcome: record.outcome,
    ...(record.error ? { error: record.error } : {})
  };
  const path = auditJournalPath();
  mkdirSync(join(getAppDataDirectory(), "audit"), { recursive: true });
  appendFileSync(path, `${JSON.stringify(complete)}\n`);
  return complete;
}

export function readAuditJournal(limit = 50): AuditRecord[] {
  const path = auditJournalPath();
  if (!existsSync(path)) {
    return [];
  }
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const records: AuditRecord[] = [];
  for (const line of lines.slice(-Math.max(1, limit))) {
    try {
      records.push(JSON.parse(line) as AuditRecord);
    } catch {
      // Skip corrupted lines rather than failing the whole read.
    }
  }
  return records;
}
