import { decodeEntities, fetchLiveInfo } from './lib/gds'
import {
  getStorageUsage,
  getTracks,
  pruneOld,
  setNowPlaying,
  setTracks,
  trackKey,
  updateTrack,
  upsertPlay,
} from './lib/storage'
import { isAuthed, searchTrack } from './lib/spotify'

const POLL_ALARM = 'mixframe-poll'
const PRUNE_ALARM = 'mixframe-prune'
const MIN_POLL_MS = 30_000 // chrome.alarms floor
const MAX_POLL_MS = 5 * 60_000
const GDS_TAB_QUERY = { url: ['*://gds.fm/*', '*://*.gds.fm/*'] }

async function gdsTabAudible(): Promise<boolean> {
  const tabs = await chrome.tabs.query({ ...GDS_TAB_QUERY, audible: true })
  return tabs.length > 0
}

function schedulePoll(delayMs: number) {
  chrome.alarms.create(POLL_ALARM, { when: Date.now() + Math.min(Math.max(delayMs, MIN_POLL_MS), MAX_POLL_MS) })
}

function setRecordIcon(live: boolean) {
  const state = live ? 'live' : 'idle'
  void chrome.action.setIcon({
    path: {
      16: `icons/record-${state}-16.png`,
      48: `icons/record-${state}-48.png`,
      128: `icons/record-${state}-128.png`,
    },
  })
}

async function stopSession() {
  await chrome.alarms.clear(POLL_ALARM)
  await setNowPlaying(null)
  chrome.action.setBadgeText({ text: '' })
  setRecordIcon(false)
}

async function poll() {
  if (!(await gdsTabAudible())) {
    await stopSession()
    return
  }

  const usage = await getStorageUsage()
  if (usage.full) {
    // storage guard: keep session alive but capture nothing until pruned
    chrome.action.setBadgeText({ text: '!' })
    chrome.action.setBadgeBackgroundColor({ color: '#d33' })
    schedulePoll(MAX_POLL_MS)
    return
  }

  try {
    const info = await fetchLiveInfo()
    const cur = info.current
    if (cur) {
      const key = cur.isSet ? trackKey('set', cur.rawName) : trackKey(cur.artist, cur.title)
      const entry = await upsertPlay(
        {
          key,
          artist: cur.isSet ? (info.showName ?? 'DJ set') : cur.artist,
          title: cur.isSet ? cur.rawName : cur.title,
          album: cur.album,
          year: cur.year,
          genre: cur.genre,
          isSet: cur.isSet,
        },
        Date.now(),
      )
      await setNowPlaying({
        key,
        artist: entry.artist,
        title: entry.title,
        isSet: cur.isSet,
        show: info.showName,
        startedAt: Date.now(),
        endsInMs: cur.endsInMs,
      })
      setRecordIcon(true)

      // background Spotify match at capture
      if (!cur.isSet && entry.spotify === undefined && (await isAuthed())) {
        try {
          const match = await searchTrack(entry.artist, entry.title)
          await updateTrack(key, { spotify: match })
        } catch {
          // leave undefined; review page offers retry
        }
      }
      schedulePoll(cur.endsInMs + 2_000)
      return
    }
  } catch {
    // API hiccup — retry on the floor interval
  }
  schedulePoll(MIN_POLL_MS)
}

// session starts when a gds.fm tab becomes audible
chrome.tabs.onUpdated.addListener((_id, changeInfo, tab) => {
  if (changeInfo.audible === true && tab.url && /(^|\.)gds\.fm/.test(new URL(tab.url).hostname)) {
    void poll()
  }
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void poll()
  if (alarm.name === PRUNE_ALARM) void pruneOld()
})

/** One-off: rows stored before entity decoding carry &#039;/&amp; in text AND in their keys. Decode, rekey, merge. */
async function migrateEncodedEntities() {
  const tracks = await getTracks()
  let changed = false
  for (const [key, t] of Object.entries(tracks)) {
    const artist = decodeEntities(t.artist)
    const title = decodeEntities(t.title)
    if (artist === t.artist && title === t.title) continue
    changed = true
    delete tracks[key]
    const newKey = t.isSet ? trackKey('set', title) : trackKey(artist, title)
    const existing = tracks[newKey]
    tracks[newKey] = {
      ...t,
      key: newKey,
      artist,
      title,
      album: t.album ? decodeEntities(t.album) : t.album,
      plays: existing ? [...existing.plays, ...t.plays].sort((a, b) => a - b) : t.plays,
      saved: existing?.saved || t.saved,
      // old match attempts ran against encoded text — drop them so re-match runs clean
      spotify: existing?.spotify ?? undefined,
    }
  }
  if (changed) await setTracks(tracks)
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(PRUNE_ALARM, { periodInMinutes: 6 * 60 })
  void migrateEncodedEntities()
  void poll()
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(PRUNE_ALARM, { periodInMinutes: 6 * 60 })
  void poll()
})

// popup/review pages can force an immediate poll or prune via messages
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'poll-now') {
    void poll().then(() => sendResponse({ ok: true }))
    return true
  }
  return undefined
})
