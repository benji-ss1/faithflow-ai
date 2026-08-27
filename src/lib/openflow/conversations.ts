"use server";
/*
 * OpenFlow conversation persistence (Increment A2). Church-scoped chat history
 * for the in-app assistant, stored one-row-per-conversation with the messages as
 * a JSONB array (a conversation is small and always read whole).
 *
 * FAIL-SOFT BY DESIGN: every function is wrapped so that if the table does not
 * exist yet (prod migration not applied) or any DB error occurs, OpenFlow keeps
 * working in-memory — list returns [], get returns null, save returns
 * { ok:false }. Nothing here ever throws to the client. Persistence simply
 * "switches on" once the migration lands.
 *
 * Church scoping (CLAUDE.md rule 5): churchId comes from the session via
 * requireCap on EVERY read and write; the client never supplies it. Adversarial
 * cross-church test in test/adversarial/openflow-conversations.test.ts.
 */
import { and, desc, eq } from "drizzle-orm";
import { requireCap } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { openFlowConversations } from "@/lib/db/schema";

export type StoredOpenFlowMsg = { role: "user" | "assistant"; content: string };
export type OpenFlowConversationSummary = {
  id: string;
  title: string;
  mode: string;
  pinned: boolean;
  updatedAt: string; // ISO
  messageCount: number;
};
export type OpenFlowConversationDetail = {
  id: string;
  title: string;
  mode: string;
  messages: StoredOpenFlowMsg[];
};

const MAX_TITLE = 80;
const MAX_MESSAGES = 200; // hard cap so a runaway thread can't bloat a row

/** Derive a short title from the first user message. */
function deriveTitle(messages: StoredOpenFlowMsg[]): string {
  const first = messages.find((m) => m.role === "user")?.content?.trim() || "New conversation";
  const oneLine = first.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_TITLE ? `${oneLine.slice(0, MAX_TITLE - 1)}…` : oneLine;
}

/** List this church's conversations, pinned first then most-recent. */
export async function listOpenFlowConversations(): Promise<OpenFlowConversationSummary[]> {
  try {
    const user = await requireCap("operate_services");
    const db = getDb();
    const rows = await db
      .select({
        id: openFlowConversations.id,
        title: openFlowConversations.title,
        mode: openFlowConversations.mode,
        pinned: openFlowConversations.pinned,
        updatedAt: openFlowConversations.updatedAt,
        messages: openFlowConversations.messages,
      })
      .from(openFlowConversations)
      .where(eq(openFlowConversations.churchId, user.churchId))
      .orderBy(desc(openFlowConversations.pinned), desc(openFlowConversations.updatedAt))
      .limit(100);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      mode: r.mode,
      pinned: r.pinned,
      updatedAt: (r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt as unknown as string)).toISOString(),
      messageCount: Array.isArray(r.messages) ? (r.messages as unknown[]).length : 0,
    }));
  } catch {
    return []; // table missing / DB error → no history, OpenFlow still works
  }
}

/** Load one conversation's full message list — church-scoped. */
export async function getOpenFlowConversation(id: string): Promise<OpenFlowConversationDetail | null> {
  try {
    const user = await requireCap("operate_services");
    const db = getDb();
    const [row] = await db
      .select()
      .from(openFlowConversations)
      .where(and(eq(openFlowConversations.id, id), eq(openFlowConversations.churchId, user.churchId)))
      .limit(1);
    if (!row) return null;
    const messages = (Array.isArray(row.messages) ? row.messages : []) as StoredOpenFlowMsg[];
    return { id: row.id, title: row.title, mode: row.mode, messages };
  } catch {
    return null;
  }
}

/**
 * Upsert a conversation after a completed turn. Pass the existing id to update,
 * or null/undefined to create a new one (auto-titled from the first user
 * message). Returns the id so the client can adopt it. Church-scoped: updates
 * only match rows owned by the caller's church.
 */
export async function saveOpenFlowConversation(input: {
  id?: string | null;
  mode: string;
  messages: StoredOpenFlowMsg[];
}): Promise<{ ok: true; id: string } | { ok: false }> {
  try {
    const user = await requireCap("operate_services");
    const db = getDb();
    const messages = (Array.isArray(input.messages) ? input.messages : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content }));
    if (messages.length === 0) return { ok: false };
    const title = deriveTitle(messages);

    if (input.id) {
      const [updated] = await db
        .update(openFlowConversations)
        .set({ messages, mode: input.mode, title, updatedAt: new Date() })
        .where(and(eq(openFlowConversations.id, input.id), eq(openFlowConversations.churchId, user.churchId)))
        .returning({ id: openFlowConversations.id });
      if (updated) return { ok: true, id: updated.id };
      // Fall through to insert if the id wasn't ours (e.g. stale client id).
    }

    const [created] = await db
      .insert(openFlowConversations)
      .values({ churchId: user.churchId, createdByUserId: user.id ?? null, title, mode: input.mode, messages })
      .returning({ id: openFlowConversations.id });
    return created ? { ok: true, id: created.id } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Rename — church-scoped. */
export async function renameOpenFlowConversation(id: string, title: string): Promise<{ ok: boolean }> {
  try {
    const user = await requireCap("operate_services");
    const clean = title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) || "Untitled";
    const db = getDb();
    await db
      .update(openFlowConversations)
      .set({ title: clean, updatedAt: new Date() })
      .where(and(eq(openFlowConversations.id, id), eq(openFlowConversations.churchId, user.churchId)));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Pin / unpin — church-scoped. */
export async function setOpenFlowConversationPinned(id: string, pinned: boolean): Promise<{ ok: boolean }> {
  try {
    const user = await requireCap("operate_services");
    const db = getDb();
    await db
      .update(openFlowConversations)
      .set({ pinned })
      .where(and(eq(openFlowConversations.id, id), eq(openFlowConversations.churchId, user.churchId)));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Delete — church-scoped. */
export async function deleteOpenFlowConversation(id: string): Promise<{ ok: boolean }> {
  try {
    const user = await requireCap("operate_services");
    const db = getDb();
    await db
      .delete(openFlowConversations)
      .where(and(eq(openFlowConversations.id, id), eq(openFlowConversations.churchId, user.churchId)));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
