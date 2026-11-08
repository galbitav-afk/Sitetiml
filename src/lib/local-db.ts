"use client";

import Dexie, { type EntityTable } from "dexie";

/**
 * Device-local storage. Audio never leaves this computer (it is big); only the
 * transcribed text goes to the cloud. Also holds the transcription queue state
 * and the list of lessons this device is responsible for summarizing.
 */

export type ChunkStatus = "recording" | "pending" | "processing" | "done" | "error";

export interface AudioChunk {
  id: string; // `${lessonId}:${idx}`
  userId: string;
  lessonId: string;
  idx: number;
  startSec: number;
  durationSec: number;
  blob: Blob;
  mime: string;
  status: ChunkStatus;
  silent: boolean;
  attempts: number;
  nextAttemptAt: number;
  text?: string;
  error?: string;
  /** Cloud backup of the audio (Supabase Storage). */
  cloud?: "uploaded" | "failed";
  cloudAttempts?: number;
}

/** A lesson this device must drive to "ready" (recorded/uploaded/regenerated here). */
export interface Job {
  lessonId: string;
  userId: string;
  createdAt: number;
  partFailures: number;
}

export const localDb = new Dexie("gal-kingdom") as Dexie & {
  chunks: EntityTable<AudioChunk, "id">;
  jobs: EntityTable<Job, "lessonId">;
};

localDb.version(1).stores({
  chunks: "id, lessonId, userId, status, [lessonId+idx]",
  jobs: "lessonId, userId",
});

export const chunkId = (lessonId: string, idx: number) => `${lessonId}:${idx}`;

export function lessonChunks(lessonId: string) {
  return localDb.chunks
    .where("[lessonId+idx]")
    .between([lessonId, Dexie.minKey], [lessonId, Dexie.maxKey])
    .toArray();
}

export async function deleteLocalLesson(lessonId: string) {
  await localDb.transaction("rw", localDb.chunks, localDb.jobs, async () => {
    await localDb.chunks.where("lessonId").equals(lessonId).delete();
    await localDb.jobs.delete(lessonId);
  });
}

/** Ask the browser not to evict our audio under storage pressure. */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* unsupported */
  }
}
