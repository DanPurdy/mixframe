import type { AuthState, NowPlaying, Settings, StorageUsage, TrackEntry, TrackMap } from '../types'

export const DEFAULT_PRUNE_DAYS = 7
/** capture pauses above this share of quota until the user prunes */
export const STORAGE_BLOCK_RATIO = 0.95
export const STORAGE_WARN_RATIO = 0.8

const TRACKS_KEY = 'tracks'
const NOW_KEY = 'nowPlaying'
const AUTH_KEY = 'auth'
const SETTINGS_KEY = 'settings'

export function trackKey(artist: string, title: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  return `${norm(artist)}::${norm(title)}`
}

export async function getTracks(): Promise<TrackMap> {
  const res = await chrome.storage.local.get(TRACKS_KEY)
  return (res[TRACKS_KEY] as TrackMap) ?? {}
}

export async function setTracks(tracks: TrackMap): Promise<void> {
  await chrome.storage.local.set({ [TRACKS_KEY]: tracks })
}

export async function upsertPlay(entry: Omit<TrackEntry, 'plays'>, playedAt: number): Promise<TrackEntry> {
  const tracks = await getTracks()
  const existing = tracks[entry.key]
  if (existing) {
    // dedupe: ignore replays within 5 min (poll jitter around same airing)
    const last = existing.plays[existing.plays.length - 1] ?? 0
    if (playedAt - last > 5 * 60_000) existing.plays.push(playedAt)
    tracks[entry.key] = { ...existing, ...entry, plays: existing.plays }
  } else {
    tracks[entry.key] = { ...entry, plays: [playedAt] }
  }
  await setTracks(tracks)
  return tracks[entry.key]
}

/** Explicit user delete — removes regardless of liked/saved state. */
export async function deleteTrack(key: string): Promise<void> {
  const tracks = await getTracks()
  if (!(key in tracks)) return
  delete tracks[key]
  await setTracks(tracks)
}

export async function updateTrack(key: string, patch: Partial<TrackEntry>): Promise<void> {
  const tracks = await getTracks()
  if (!tracks[key]) return
  tracks[key] = { ...tracks[key], ...patch }
  await setTracks(tracks)
}

/** Remove unsaved tracks whose newest play is older than the configured prune window. Saved tracks kept forever. Returns count removed; -1 if pruning disabled. */
export async function pruneOld(): Promise<number> {
  const { pruneDays } = await getSettings()
  const days = pruneDays ?? DEFAULT_PRUNE_DAYS
  if (days === 'never') return -1
  const tracks = await getTracks()
  const cutoff = Date.now() - days * 24 * 60 * 60_000
  let removed = 0
  for (const [key, t] of Object.entries(tracks)) {
    if (t.saved || t.liked) continue
    const newest = t.plays[t.plays.length - 1] ?? 0
    if (newest < cutoff) {
      delete tracks[key]
      removed++
    }
  }
  if (removed > 0) await setTracks(tracks)
  return removed
}

export async function getStorageUsage(): Promise<StorageUsage> {
  const bytesInUse = await chrome.storage.local.getBytesInUse(null)
  const quotaBytes = chrome.storage.local.QUOTA_BYTES ?? 10 * 1024 * 1024
  const ratio = bytesInUse / quotaBytes
  return { bytesInUse, quotaBytes, ratio, full: ratio >= STORAGE_BLOCK_RATIO }
}

/** Aggressive manual prune: drop unsaved+unliked tracks older than `days` regardless of settings. */
export async function pruneNow(days: number): Promise<number> {
  const tracks = await getTracks()
  const cutoff = Date.now() - days * 24 * 60 * 60_000
  let removed = 0
  for (const [key, t] of Object.entries(tracks)) {
    if (t.saved || t.liked) continue
    const newest = t.plays[t.plays.length - 1] ?? 0
    if (newest < cutoff) {
      delete tracks[key]
      removed++
    }
  }
  if (removed > 0) await setTracks(tracks)
  return removed
}

export async function getNowPlaying(): Promise<NowPlaying | null> {
  const res = await chrome.storage.local.get(NOW_KEY)
  return (res[NOW_KEY] as NowPlaying) ?? null
}

export async function setNowPlaying(now: NowPlaying | null): Promise<void> {
  if (now === null) await chrome.storage.local.remove(NOW_KEY)
  else await chrome.storage.local.set({ [NOW_KEY]: now })
}

export async function getAuth(): Promise<AuthState | null> {
  const res = await chrome.storage.local.get(AUTH_KEY)
  return (res[AUTH_KEY] as AuthState) ?? null
}

export async function setAuth(auth: AuthState | null): Promise<void> {
  if (auth === null) await chrome.storage.local.remove(AUTH_KEY)
  else await chrome.storage.local.set({ [AUTH_KEY]: auth })
}

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(SETTINGS_KEY)
  return (res[SETTINGS_KEY] as Settings) ?? {}
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings()
  const next = { ...cur, ...patch }
  await chrome.storage.local.set({ [SETTINGS_KEY]: next })
  return next
}
