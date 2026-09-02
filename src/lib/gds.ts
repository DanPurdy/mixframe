const API_URL = 'https://live.gds.fm/api/live-info-v2'

/** One "track" slot from LibreTime — may actually be a DJ set. */
export interface GdsTrack {
  artist: string
  title: string
  album?: string
  year?: string
  genre?: string
  /** raw display name, e.g. "Erika de Casier - ice" or a set name */
  rawName: string
  lengthSec?: number
  isSet: boolean
  /** ms until this track ends, per station clock */
  endsInMs: number
}

export interface GdsInfo {
  current: GdsTrack | null
  next: GdsTrack | null
  showName?: string
}

interface RawTrack {
  name?: string
  starts?: string
  ends?: string
  metadata?: {
    artist_name?: string
    track_title?: string
    album_title?: string
    year?: string
    genre?: string
    length?: string
  }
}

/** LibreTime HTML-encodes names (&#039;, &amp;). No DOMParser in a service worker, so decode by hand. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function parseLengthSec(len?: string): number | undefined {
  if (!len) return undefined
  const m = len.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/)
  if (!m) return undefined
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/** Naive station-local timestamps: diff against schedulerTime, never the local clock. */
function naiveMs(s?: string): number | undefined {
  if (!s) return undefined
  const t = Date.parse(s.replace(' ', 'T') + 'Z') // fake UTC; only used for diffs
  return Number.isNaN(t) ? undefined : t
}

const SET_LENGTH_SEC = 20 * 60

function toTrack(raw: RawTrack | null | undefined, schedulerMs: number, showName?: string): GdsTrack | null {
  if (!raw || !raw.name) return null
  const md = raw.metadata ?? {}
  const lengthSec = parseLengthSec(md.length)
  const name = decodeEntities(raw.name)
  let artist = decodeEntities(md.artist_name ?? '').trim()
  let title = decodeEntities(md.track_title ?? '').trim()
  if (!artist || !title) {
    // fall back to splitting the display name "Artist - Title"
    const parts = name.split(' - ')
    if (parts.length >= 2) {
      artist = artist || parts[0].trim()
      title = title || parts.slice(1).join(' - ').trim()
    } else {
      title = title || name.trim()
    }
  }
  const isSet =
    (lengthSec !== undefined && lengthSec > SET_LENGTH_SEC) ||
    !artist ||
    (!!showName && name.trim().toLowerCase() === showName.trim().toLowerCase())
  const endsMs = naiveMs(raw.ends)
  return {
    artist,
    title,
    album: md.album_title ? decodeEntities(md.album_title) : undefined,
    year: md.year || undefined,
    genre: md.genre ? decodeEntities(md.genre) : undefined,
    rawName: name,
    lengthSec,
    isSet,
    endsInMs: endsMs !== undefined ? Math.max(0, endsMs - schedulerMs) : 0,
  }
}

export async function fetchLiveInfo(): Promise<GdsInfo> {
  const res = await fetch(API_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`gds.fm API ${res.status}`)
  const data = await res.json()
  const schedulerMs = naiveMs(data?.station?.schedulerTime) ?? Date.now()
  const rawShow = data?.shows?.current?.name
  const showName: string | undefined = rawShow ? decodeEntities(rawShow) : undefined
  return {
    current: toTrack(data?.tracks?.current, schedulerMs, showName),
    next: toTrack(data?.tracks?.next, schedulerMs, showName),
    showName,
  }
}
