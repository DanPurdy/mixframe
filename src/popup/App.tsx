import { useEffect, useState } from 'preact/hooks'
import type { NowPlaying, TrackEntry } from '../types'
import { getNowPlaying, getStorageUsage, getTracks } from '../lib/storage'
import { saveToPlaylist } from '../lib/spotify'
import { updateTrack } from '../lib/storage'

export function App() {
  const [now, setNow] = useState<NowPlaying | null>(null)
  const [recent, setRecent] = useState<TrackEntry[]>([])
  const [storageFull, setStorageFull] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    setNow(await getNowPlaying())
    const tracks = await getTracks()
    const sorted = Object.values(tracks).sort(
      (a, b) => (b.plays[b.plays.length - 1] ?? 0) - (a.plays[a.plays.length - 1] ?? 0),
    )
    setRecent(sorted.slice(0, 6))
    setStorageFull((await getStorageUsage()).full)
  }

  useEffect(() => {
    void load()
    chrome.runtime.sendMessage({ type: 'poll-now' }).catch(() => {})
    const listener = () => void load()
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const save = async (t: TrackEntry) => {
    if (!t.spotify) return
    setBusy(t.key)
    try {
      await saveToPlaylist(t.spotify.uri)
      await updateTrack(t.key, { saved: true, savedAt: Date.now() })
    } finally {
      setBusy(null)
    }
  }

  const openReview = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/review/index.html') })
  }

  return (
    <div class="popup">
      <header>
        <h1>mixframe</h1>
        <span class={`dot ${now ? 'live' : ''}`} title={now ? 'capturing' : 'idle'} />
      </header>

      {storageFull && (
        <div class="warn">Storage full — capture paused. Open review page to prune.</div>
      )}

      {now ? (
        <div class="now">
          <div class="label">{now.isSet ? 'On air (set)' : 'Now playing'}</div>
          <div class="title">{now.title}</div>
          {!now.isSet && <div class="artist">{now.artist}</div>}
          {now.show && <div class="show">{now.show}</div>}
        </div>
      ) : (
        <div class="idle">Not capturing — play gds.fm in a tab.</div>
      )}

      <ul class="recent">
        {recent.map((t) => (
          <li key={t.key}>
            <div class="meta">
              <span class="t">{t.title}</span>
              <span class="a">{t.isSet ? 'DJ set' : t.artist}</span>
            </div>
            <button
              class={`heart ${t.liked ? 'on' : ''}`}
              title={t.liked ? 'Unlike' : 'Like (kept even without Spotify match)'}
              onClick={() =>
                void updateTrack(t.key, { liked: !t.liked, likedAt: t.liked ? undefined : Date.now() })
              }
            >
              {t.liked ? '♥' : '♡'}
            </button>
            {t.saved ? (
              <span class="saved">✓</span>
            ) : t.spotify ? (
              <button disabled={busy === t.key} onClick={() => save(t)} title="Save to GDS finds">
                {busy === t.key ? '…' : '+'}
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <footer>
        <button class="link" onClick={openReview}>
          Open playlist →
        </button>
      </footer>
    </div>
  )
}
