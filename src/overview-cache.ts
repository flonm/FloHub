import type { Overview } from "./github";
import { type PullRef, pullKey } from "./pull-ref";

const INDEX_KEY = "overviewIndex";
const ENTRY_PREFIX = "overview:";
const MAX_ENTRIES = 50;
const MAX_AGE_MS = 7 * 24 * 3_600_000;

/** What the index keeps per cached pull request, so a lookup reads one entry instead of all of them. */
interface IndexEntry {
  savedAt: number;
  /** The repository, as "owner/repo". */
  repo: string;
  /** Every pull request number in the cached stack, the cached one included. */
  members: number[];
}

export type CacheIndex = Record<string, IndexEntry>;

export interface CachedOverview {
  overview: Overview;
  /** False when the overview belongs to another layer of the same stack, so only its stack applies. */
  exact: boolean;
}

/**
 * Picks the cached overview to show for a pull request: its own, or else the newest one whose stack contains it.
 * @param index The cache index.
 * @param ref The pull request.
 * @param now The current time.
 * @returns The cache key and whether it is the pull request's own, or null.
 */
export function pickCacheKey(index: CacheIndex, ref: PullRef, now: number): { key: string; exact: boolean } | null {
  const own = pullKey(ref);
  const fresh = (entry: IndexEntry) => now - entry.savedAt <= MAX_AGE_MS;
  const exact = index[own];
  if (exact && fresh(exact)) return { key: own, exact: true };

  const repo = `${ref.owner}/${ref.repo}`;
  let best: { key: string; savedAt: number } | null = null;
  for (const [key, entry] of Object.entries(index)) {
    if (entry.repo !== repo || !fresh(entry) || !entry.members.includes(ref.number)) continue;
    if (!best || entry.savedAt > best.savedAt) best = { key, savedAt: entry.savedAt };
  }
  return best && { key: best.key, exact: false };
}

/**
 * @param index The cache index after the newest write.
 * @param now The current time.
 * @returns The keys to drop: expired entries, then the oldest beyond the size limit.
 */
export function keysToEvict(index: CacheIndex, now: number): string[] {
  const byAge = Object.entries(index).toSorted(([, a], [, b]) => b.savedAt - a.savedAt);
  return byAge
    .filter(([, entry], position) => position >= MAX_ENTRIES || now - entry.savedAt > MAX_AGE_MS)
    .map(([key]) => key);
}

/**
 * @param ref The pull request.
 * @returns The last overview fetched for it or for another layer of its stack, or null.
 */
export async function readCachedOverview(ref: PullRef): Promise<CachedOverview | null> {
  try {
    const index = await readIndex();
    const pick = pickCacheKey(index, ref, Date.now());
    if (!pick) return null;
    const stored = await chrome.storage.local.get(ENTRY_PREFIX + pick.key);
    const overview = stored[ENTRY_PREFIX + pick.key] as Overview | undefined;
    return overview ? { overview, exact: pick.exact } : null;
  } catch {
    return null;
  }
}

let writes: Promise<void> = Promise.resolve();

/**
 * Runs cache writes one after another. Only the service worker writes, so tabs never overwrite each other's index.
 * @param write The write to queue.
 */
export async function queueCacheWrite(write: () => Promise<void>): Promise<void> {
  writes = afterPrevious(writes, write);
  await writes;
}

async function afterPrevious(previous: Promise<void>, write: () => Promise<void>): Promise<void> {
  try {
    await previous;
  } catch {
    // A failed write doesn't hold up the ones queued after it.
  }
  await write();
}

/**
 * Stores a freshly fetched overview and drops expired or surplus entries. Call it through queueCacheWrite.
 * @param ref The pull request.
 * @param overview The overview GitHub returned.
 */
export async function writeCachedOverview(ref: PullRef, overview: Overview): Promise<void> {
  const pullRequest = overview.repository?.pullRequest;
  if (!pullRequest) return;
  const key = pullKey(ref);
  const members = pullRequest.stack?.entries.nodes.flatMap((node) => node.pullRequest?.number ?? []);
  try {
    const index = await readIndex();
    index[key] = { savedAt: Date.now(), repo: `${ref.owner}/${ref.repo}`, members: members ?? [ref.number] };
    const evicted = keysToEvict(index, Date.now());
    const kept = Object.fromEntries(Object.entries(index).filter(([old]) => !evicted.includes(old)));
    await chrome.storage.local.set({ [ENTRY_PREFIX + key]: overview, [INDEX_KEY]: kept });
    if (evicted.length > 0) await chrome.storage.local.remove(evicted.map((old) => ENTRY_PREFIX + old));
  } catch {
    // A full or unavailable storage only costs the next visit its head start.
  }
}

/** Drops every cached overview, for when the token, and with it the viewer, changes. Call it through queueCacheWrite. */
export async function clearOverviewCache(): Promise<void> {
  try {
    const index = await readIndex();
    await chrome.storage.local.remove([INDEX_KEY, ...Object.keys(index).map((key) => ENTRY_PREFIX + key)]);
  } catch {
    // Entries left behind still expire after a week.
  }
}

async function readIndex(): Promise<CacheIndex> {
  const stored = await chrome.storage.local.get(INDEX_KEY);
  const index = stored[INDEX_KEY];
  return typeof index === "object" && index !== null ? (index as CacheIndex) : {};
}
