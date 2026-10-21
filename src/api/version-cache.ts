import type { VersionPatch } from "./github";
import { type PullRef, pullKey } from "../core/pull-ref";
import type { VersionHistory } from "../core/versions";

const PATCH_INDEX_KEY = "versionPatchIndex";
const PATCH_PREFIX = "versionPatch:";
const HISTORY_KEY = "versionHistories";
/** About two compared pairs for each of the last few pull requests. */
const MAX_PATCHES = 16;
const MAX_HISTORIES = 30;
const MAX_AGE_MS = 3 * 86_400_000;
/** A patch longer than this, as JSON, is fetched again rather than stored. */
const MAX_PATCH_LENGTH = 4_000_000;
/** A hit on a patch used more recently than this leaves its last use as it is, which saves a write. */
const TOUCH_AFTER_MS = 3_600_000;

/** When each stored patch was last used, by {@link patchKey}. */
export type PatchIndex = Record<string, number>;

interface CachedHistory {
  savedAt: number;
  history: VersionHistory;
}

/**
 * A version's patch depends only on its commit and the bases it was compared with, which are all commits too, so a
 * stored patch never goes stale: the cache only has to stay small.
 * @param ref The pull request.
 * @param head The version's commit.
 * @param bases The candidate bases it was compared with.
 * @returns The key the patch is stored under.
 */
export function patchKey(ref: PullRef, head: string, bases: string[]): string {
  return `${ref.owner}/${ref.repo}:${head}:${bases.join(",")}`;
}

/**
 * @param index When each stored patch was last used.
 * @param now The current time.
 * @returns The keys to drop: patches unused for days, then the least recently used beyond the size limit.
 */
export function patchesToEvict(index: PatchIndex, now: number): string[] {
  return Object.entries(index)
    .toSorted(([, a], [, b]) => b - a)
    .filter(([, usedAt], position) => position >= MAX_PATCHES || now - usedAt > MAX_AGE_MS)
    .map(([key]) => key);
}

/**
 * @param histories The stored histories, by pull request.
 * @param now The current time.
 * @returns Those still worth keeping: the most recently fetched ones younger than a few days.
 */
export function keepRecentHistories(histories: Record<string, CachedHistory>, now: number): Record<string, CachedHistory> {
  return Object.fromEntries(
    Object.entries(histories)
      .filter(([, entry]) => now - entry.savedAt <= MAX_AGE_MS)
      .toSorted(([, a], [, b]) => b.savedAt - a.savedAt)
      .slice(0, MAX_HISTORIES),
  );
}

/**
 * Two patches of a version diffed against bases that moved, which usually leaves what the version changes as it was.
 * @param a One patch.
 * @param b The other.
 * @returns Whether they diff the same files against the same merge base.
 */
export function samePatch(a: VersionPatch, b: VersionPatch): boolean {
  if (a.mergeBase !== b.mergeBase || a.onBase !== b.onBase || a.truncated !== b.truncated || a.files.length !== b.files.length) {
    return false;
  }
  return a.files.every((file, index) => {
    const other = b.files[index];
    return other?.filename === file.filename && other.sha === file.sha && other.status === file.status && other.patch === file.patch;
  });
}

let writes: Promise<unknown> = Promise.resolve();

/**
 * Runs reads and writes of the stored versions one after another, apart from the overview cache's, so a large patch
 * never holds up an overview. Only the service worker calls it, so tabs never overwrite each other's index.
 * @param task The read or write.
 * @returns What the task resolves to.
 */
export async function queueVersionCache<T>(task: () => Promise<T>): Promise<T> {
  const queued = afterPrevious(writes, task);
  writes = queued;
  return queued;
}

async function afterPrevious<T>(previous: Promise<unknown>, task: () => Promise<T>): Promise<T> {
  try {
    await previous;
  } catch {
    // A failed write doesn't hold up the ones queued after it.
  }
  return task();
}

/**
 * @param key The patch's {@link patchKey}.
 * @returns The stored patch, or null. Call it through {@link queueVersionCache}, since a hit marks the patch as used.
 */
export async function readCachedPatch(key: string): Promise<VersionPatch | null> {
  try {
    const index = await readPatchIndex();
    if (index[key] === undefined || Date.now() - index[key] > MAX_AGE_MS) return null;
    const stored = await chrome.storage.local.get(PATCH_PREFIX + key);
    const patch = stored[PATCH_PREFIX + key] as VersionPatch | undefined;
    if (!patch) return null;
    if (Date.now() - index[key] > TOUCH_AFTER_MS) await chrome.storage.local.set({ [PATCH_INDEX_KEY]: { ...index, [key]: Date.now() } });
    return patch;
  } catch {
    return null;
  }
}

/**
 * Stores a freshly fetched patch and drops the ones past the limits. Call it through {@link queueVersionCache}.
 * @param key The patch's {@link patchKey}.
 * @param patch The patch.
 */
export async function writeCachedPatch(key: string, patch: VersionPatch): Promise<void> {
  if (JSON.stringify(patch).length > MAX_PATCH_LENGTH) return;
  try {
    const now = Date.now();
    const index = { ...(await readPatchIndex()), [key]: now };
    const evicted = patchesToEvict(index, now);
    const kept = Object.fromEntries(Object.entries(index).filter(([old]) => !evicted.includes(old)));
    await chrome.storage.local.set({ [PATCH_PREFIX + key]: patch, [PATCH_INDEX_KEY]: kept });
    if (evicted.length > 0) await chrome.storage.local.remove(evicted.map((old) => PATCH_PREFIX + old));
  } catch {
    // A full or unavailable storage only costs the next comparison its head start.
  }
}

/**
 * @param ref The pull request.
 * @returns The versions last fetched for it, to show while they are fetched again, or null.
 */
export async function readCachedHistory(ref: PullRef): Promise<VersionHistory | null> {
  try {
    const stored = await chrome.storage.local.get(HISTORY_KEY);
    const entry = (stored[HISTORY_KEY] as Record<string, CachedHistory> | undefined)?.[pullKey(ref)];
    return entry && Date.now() - entry.savedAt <= MAX_AGE_MS ? entry.history : null;
  } catch {
    return null;
  }
}

/**
 * Stores freshly fetched versions. Call it through {@link queueVersionCache}.
 * @param ref The pull request.
 * @param history Its versions.
 */
export async function writeCachedHistory(ref: PullRef, history: VersionHistory): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(HISTORY_KEY);
    const now = Date.now();
    const histories = { ...(stored[HISTORY_KEY] as Record<string, CachedHistory> | undefined), [pullKey(ref)]: { savedAt: now, history } };
    await chrome.storage.local.set({ [HISTORY_KEY]: keepRecentHistories(histories, now) });
  } catch {
    // Without it, the next visit waits for the versions.
  }
}

/** Drops every stored version and patch, for when the token, and with it the viewer, changes. */
export async function clearVersionCache(): Promise<void> {
  try {
    const index = await readPatchIndex();
    await chrome.storage.local.remove([PATCH_INDEX_KEY, HISTORY_KEY, ...Object.keys(index).map((key) => PATCH_PREFIX + key)]);
  } catch {
    // Entries left behind still expire after a few days.
  }
}

async function readPatchIndex(): Promise<PatchIndex> {
  const stored = await chrome.storage.local.get(PATCH_INDEX_KEY);
  const index = stored[PATCH_INDEX_KEY];
  return typeof index === "object" && index !== null ? (index as PatchIndex) : {};
}
