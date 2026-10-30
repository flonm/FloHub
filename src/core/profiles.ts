import type { Inbox, InboxGroup } from "./inbox";

/**
 * Two named lists of repository owners and repositories, one of them active, so the inbox can show the work
 * organization during the week and the viewer's own projects at the weekend. A repository goes where its own entry
 * says, else where its owner's does, and shows in both profiles when neither is listed.
 */
export interface Profiles {
  names: [string, string];
  /** The profile the inbox shows, or null for every repository. */
  active: ProfileIndex | null;
  /** Which profile each owner or repository belongs to, by lowercase login or lowercase `owner/name`. */
  entries: Record<string, ProfileIndex>;
}

export type ProfileIndex = 0 | 1;

export const PROFILES_KEY = "profiles";

export const DEFAULT_PROFILES: Profiles = { names: ["Work", "Personal"], active: null, entries: {} };

/**
 * @param raw What storage holds, anything from an older version or nothing.
 * @returns The profiles, with the defaults for whatever is missing or malformed.
 */
export function readProfiles(raw: unknown): Profiles {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PROFILES;
  const { names, active, entries } = raw as Partial<Record<keyof Profiles, unknown>>;
  const name = (index: ProfileIndex) => {
    const value = Array.isArray(names) ? (names[index] as unknown) : undefined;
    return typeof value === "string" && value.trim() !== "" ? value.trim() : DEFAULT_PROFILES.names[index];
  };
  const kept: Record<string, ProfileIndex> = {};
  if (typeof entries === "object" && entries !== null) {
    for (const [entry, index] of Object.entries(entries)) if (isIndex(index)) kept[entry.toLowerCase()] = index;
  }
  return { names: [name(0), name(1)], active: isIndex(active) ? active : null, entries: kept };
}

function isIndex(value: unknown): value is ProfileIndex {
  return value === 0 || value === 1;
}

/**
 * @param profiles The profiles.
 * @param repo A repository as `owner/name`.
 * @returns The profile it belongs to: its own entry's, else its owner's, or null when it belongs to both.
 */
export function profileOf(profiles: Profiles, repo: string): ProfileIndex | null {
  const lower = repo.toLowerCase();
  const [owner = ""] = lower.split("/", 1);
  return profiles.entries[lower] ?? profiles.entries[owner] ?? null;
}

/**
 * @param profiles The profiles.
 * @param repo A repository as `owner/name`.
 * @returns Whether the active profile shows it: every repository without one, else those on its list or on neither.
 */
export function showsRepo(profiles: Profiles, repo: string): boolean {
  if (profiles.active === null) return true;
  const profile = profileOf(profiles, repo);
  return profile === null || profile === profiles.active;
}

/**
 * The stored inbox holds every repository, so switching profiles is instant and keeps the other profile's pins.
 * @param inbox The whole inbox.
 * @param profiles The profiles.
 * @returns The inbox as the active profile shows it, its counts redone; the same inbox when it hides nothing.
 */
export function profileInbox(inbox: Inbox, profiles: Profiles): Inbox {
  if (profiles.active === null) return inbox;
  const keep = (groups: InboxGroup[]) => profileGroups(groups, profiles);
  const review = keep(inbox.review);
  const mine = keep(inbox.mine);
  const waiting = inbox.waiting && keep(inbox.waiting);
  const other = inbox.other && keep(inbox.other);
  const same = review.length === inbox.review.length && mine.length === inbox.mine.length;
  if (same && waiting?.length === inbox.waiting?.length && other?.length === inbox.other?.length) return inbox;
  const pulls = [...review, ...mine, ...(waiting ?? [])].flatMap((entry) => entry.pulls);
  return {
    ...inbox,
    review,
    mine,
    ...(waiting && { waiting }),
    ...(other && { other }),
    reviewCount: review.reduce((sum, entry) => sum + entry.pulls.length, 0),
    ...(inbox.turnCount !== undefined && { turnCount: pulls.filter((pull) => pull.turn?.whose === "you").length }),
  };
}

/**
 * @param groups Groups of pull requests.
 * @param profiles The profiles.
 * @returns The groups in repositories the active profile shows.
 */
export function profileGroups(groups: InboxGroup[], profiles: Profiles): InboxGroup[] {
  return profiles.active === null ? groups : groups.filter((entry) => showsRepo(profiles, entry.repo));
}

/**
 * @param inbox The whole inbox.
 * @param profiles The profiles.
 * @returns What "Everything else" searches: every known owner the active profile shows, and each repository on the
 *   active profile whose owner it doesn't show. A repository it hides under a shown owner is left out when drawn.
 */
export function searchScopes(inbox: Pick<Inbox, "review" | "mine" | "waiting"> | undefined, profiles: Profiles): string[] {
  const shown = (entry: string) => {
    const profile = profiles.entries[entry];
    return profiles.active === null || profile === undefined || profile === profiles.active;
  };
  return knownEntries(inbox, profiles).filter((entry) => {
    if (!entry.includes("/")) return shown(entry);
    return profiles.active !== null && profiles.entries[entry] === profiles.active && !shown(ownerOf(entry));
  });
}

/**
 * @param inbox The whole inbox.
 * @param profiles The profiles.
 * @returns Every owner the inbox names and every owner or repository the profiles list, lowercase, each once and
 *   sorted, so a repository's entry follows its owner's.
 */
export function knownEntries(inbox: Pick<Inbox, "review" | "mine" | "waiting"> | undefined, profiles: Profiles): string[] {
  const entries = new Set(Object.keys(profiles.entries));
  for (const entry of [...(inbox?.review ?? []), ...(inbox?.mine ?? []), ...(inbox?.waiting ?? [])]) {
    const [owner] = entry.repo.split("/", 1);
    if (owner) entries.add(owner.toLowerCase());
  }
  return [...entries].toSorted((a, b) => {
    const byOwner = ownerOf(a).localeCompare(ownerOf(b));
    return byOwner === 0 ? a.localeCompare(b) : byOwner;
  });
}

/** @returns The owner of an entry, which for an owner is itself. */
function ownerOf(entry: string): string {
  return entry.split("/", 1)[0] ?? entry;
}

/**
 * @param profiles The profiles.
 * @param entry An owner, or a repository as `owner/name`.
 * @param profile The profile it goes to, or null for both, which for a repository means following its owner.
 * @returns The profiles with the entry moved.
 */
export function assignEntry(profiles: Profiles, entry: string, profile: ProfileIndex | null): Profiles {
  const key = entry.toLowerCase();
  const entries = Object.fromEntries(Object.entries(profiles.entries).filter(([other]) => other !== key));
  return { ...profiles, entries: profile === null ? entries : { ...entries, [key]: profile } };
}

/** @returns The profiles kept in sync storage, so they follow the viewer to their other browsers. */
export async function loadProfiles(): Promise<Profiles> {
  const stored = await chrome.storage.sync.get(PROFILES_KEY);
  return readProfiles(stored[PROFILES_KEY]);
}

/** @param profiles The profiles to keep. */
export async function saveProfiles(profiles: Profiles): Promise<void> {
  await chrome.storage.sync.set({ [PROFILES_KEY]: profiles });
}
