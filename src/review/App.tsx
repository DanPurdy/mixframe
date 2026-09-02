import { useEffect, useMemo, useState } from 'preact/hooks'
import type { NowPlaying, Settings, StorageUsage, TrackEntry } from '../types'
import {
  DEFAULT_PRUNE_DAYS,
  STORAGE_WARN_RATIO,
  getSettings,
  deleteTrack,
  getNowPlaying,
  getStorageUsage,
  getTracks,
  patchSettings,
  pruneNow,
  updateTrack,
} from '../lib/storage'
import { isAuthed, login, logout, redirectUri, saveToPlaylist, searchTrack, searchUrl } from '../lib/spotify'

type Filter = 'all' | 'unsaved' | 'liked' | 'saved' | 'sets' | 'unmatched'

const PRUNE_OPTIONS: Array<{ value: number | 'never'; label: string }> = [
  { value: 3, label: '3 days' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 'never', label: 'never' },
]

function fmtBytes(n: number): string {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}

function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function App() {
  const [tracks, setTracksState] = useState<TrackEntry[]>([])
  const [now, setNow] = useState<NowPlaying | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [authed, setAuthed] = useState(false)
  const [settings, setSettings] = useState<Settings>({})
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    const map = await getTracks()
    setTracksState(
      Object.values(map).sort(
        (a, b) => (b.plays[b.plays.length - 1] ?? 0) - (a.plays[a.plays.length - 1] ?? 0),
      ),
    )
    setNow(await getNowPlaying())
    setAuthed(await isAuthed())
    setSettings(await getSettings())
    setUsage(await getStorageUsage())
  }

  useEffect(() => {
    void load()
    const listener = () => void load()
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const visible = useMemo(() => {
    let list = tracks
    if (filter === 'unsaved') list = list.filter((t) => !t.saved && !t.isSet)
    if (filter === 'liked') list = list.filter((t) => t.liked)
    if (filter === 'saved') list = list.filter((t) => t.saved)
    if (filter === 'sets') list = list.filter((t) => t.isSet)
    if (filter === 'unmatched') list = list.filter((t) => !t.isSet && !t.spotify)
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(
        (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
      )
    }
    return list
  }, [tracks, filter, query])

  const pageSize = settings.pageSize ?? 20
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageItems = visible.slice(safePage * pageSize, (safePage + 1) * pageSize)

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const save = (t: TrackEntry) =>
    act(t.key, async () => {
      if (!t.spotify) return
      await saveToPlaylist(t.spotify.uri)
      await updateTrack(t.key, { saved: true, savedAt: Date.now() })
    })

  const rematch = (t: TrackEntry) =>
    act(t.key, async () => {
      const match = await searchTrack(t.artist, t.title)
      await updateTrack(t.key, { spotify: match })
    })

  const doPrune = async (days: number) => {
    const removed = await pruneNow(days)
    setError(removed >= 0 ? `Pruned ${removed} track(s).` : null)
    await load()
  }

  const pruneDays = settings.pruneDays ?? DEFAULT_PRUNE_DAYS
  const nearLimit = usage !== null && usage.ratio >= STORAGE_WARN_RATIO

  return (
    <div class="page">
      <header>
        <h1>mixframe</h1>
        <div class="header-actions">
          {settings.playlistId && (
            <a
              class="ghost"
              href={`https://open.spotify.com/playlist/${settings.playlistId}`}
              target="_blank"
              rel="noreferrer"
            >
              {settings.playlistName ?? 'GDS finds'} ↗
            </a>
          )}
          {authed ? (
            <button class="ghost" onClick={() => act('auth', async () => { await logout(); await load() })}>
              Disconnect Spotify
            </button>
          ) : (
            <button class="primary" onClick={() => act('auth', async () => { await login(); await load() })}>
              Connect Spotify
            </button>
          )}
          <button class="ghost" onClick={() => setShowSettings(!showSettings)}>
            ⚙︎ Settings
          </button>
        </div>
      </header>

      <div class={`onair ${now ? 'live' : ''}`}>
        <span class="onair-dot" />
        {now ? (
          <span>
            <strong>On air:</strong> {now.title}
            {!now.isSet && ` — ${now.artist}`}
            {now.show && <span class="onair-show"> · {now.show}</span>}
          </span>
        ) : (
          <span>Not capturing — play gds.fm in a tab</span>
        )}
      </div>

      {error && <div class="banner">{error}</div>}

      {usage?.full && (
        <div class="banner danger">
          <strong>Storage full — capture paused.</strong> Prune below to resume.
          <button onClick={() => doPrune(1)}>Prune unsaved older than 1 day</button>
        </div>
      )}

      {showSettings && (
        <section class="settings">
          <h2>Settings</h2>
          <label>
            Spotify client ID
            <input
              type="text"
              value={settings.clientId ?? ''}
              placeholder="leave empty to use the built-in app"
              onChange={(e) =>
                void patchSettings({ clientId: (e.target as HTMLInputElement).value.trim() }).then(setSettings)
              }
            />
          </label>
          <p class="hint">
            Redirect URI for your Spotify app: <code>{redirectUri()}</code>
          </p>
          <label>
            Spotify playlist name
            <input
              type="text"
              value={settings.playlistName ?? ''}
              placeholder="GDS finds"
              onChange={(e) => {
                const v = (e.target as HTMLInputElement).value.trim()
                // changing the name invalidates the cached playlist id — next save re-finds or creates
                void patchSettings({ playlistName: v || undefined, playlistId: undefined }).then(setSettings)
              }}
            />
          </label>
          <p class="hint">Saves go to this playlist (found by name in your library, created if missing).</p>
          <label>
            Prune unsaved tracks after
            <select
              value={String(pruneDays)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                void patchSettings({ pruneDays: v === 'never' ? 'never' : Number(v) }).then(setSettings)
              }}
            >
              {PRUNE_OPTIONS.map((o) => (
                <option value={String(o.value)}>{o.label}</option>
              ))}
            </select>
          </label>
          {usage && (
            <div class={`storage ${nearLimit ? 'warn' : ''}`}>
              <div class="bar">
                <div class="fill" style={{ width: `${Math.min(usage.ratio * 100, 100)}%` }} />
              </div>
              <span>
                {fmtBytes(usage.bytesInUse)} / {fmtBytes(usage.quotaBytes)} used
                {nearLimit && ' — getting close, consider pruning'}
              </span>
              <button class="ghost" onClick={() => doPrune(typeof pruneDays === 'number' ? pruneDays : 7)}>
                Prune now
              </button>
            </div>
          )}
        </section>
      )}

      <div class="toolbar">
        <input
          type="search"
          placeholder="Search…"
          value={query}
          onInput={(e) => {
            setQuery((e.target as HTMLInputElement).value)
            setPage(0)
          }}
        />
        {(['all', 'unsaved', 'liked', 'saved', 'sets', 'unmatched'] as Filter[]).map((f) => (
          <button
            class={`chip ${filter === f ? 'on' : ''}`}
            onClick={() => {
              setFilter(f)
              setPage(0)
            }}
          >
            {f}
          </button>
        ))}
      </div>

      <ul class="tracks">
        {pageItems.map((t) => (
          <li key={t.key} class={`${t.saved ? 'is-saved' : ''} ${now?.key === t.key ? 'is-playing' : ''}`}>
            <div class="art">
              {t.spotify?.image ? <img src={t.spotify.image} alt="" /> : <div class="ph">{t.isSet ? '📻' : '♪'}</div>}
            </div>
            <div class="meta">
              <div class="title">{t.title}</div>
              <div class="artist">{t.isSet ? `DJ set · ${t.artist}` : t.artist}</div>
              <div class="sub">
                heard {t.plays.length}× · last {fmtWhen(t.plays[t.plays.length - 1] ?? 0)}
                {t.album && ` · ${t.album}`}
                {t.spotify?.confidence === 'low' && <span class="low"> · match uncertain</span>}
              </div>
            </div>
            <div class="actions">
              <button
                class={`heart ${t.liked ? 'on' : ''}`}
                title={t.liked ? 'Unlike (allows pruning)' : 'Like (kept forever, no Spotify needed)'}
                onClick={() =>
                  void updateTrack(t.key, { liked: !t.liked, likedAt: t.liked ? undefined : Date.now() })
                }
              >
                {t.liked ? '♥' : '♡'}
              </button>
              {!t.isSet && t.spotify && (
                <button class="ghost" onClick={() => setPlaying(playing === t.key ? null : t.key)}>
                  {playing === t.key ? 'Close' : '▶ Play'}
                </button>
              )}
              {!t.isSet && (
                <a class="ghost" href={searchUrl(t.artist, t.title)} target="_blank" rel="noreferrer">
                  Search ↗
                </a>
              )}
              {!t.isSet && !t.spotify && authed && (
                <button class="ghost" disabled={busy === t.key} onClick={() => rematch(t)}>
                  Match
                </button>
              )}
              {t.saved ? (
                settings.playlistId ? (
                  <a
                    class="saved"
                    href={`https://open.spotify.com/playlist/${settings.playlistId}`}
                    target="_blank"
                    rel="noreferrer"
                    title={`In "${settings.playlistName ?? 'GDS finds'}" on Spotify`}
                  >
                    ✓ saved ↗
                  </a>
                ) : (
                  <span class="saved">✓ saved</span>
                )
              ) : (
                !t.isSet &&
                t.spotify && (
                  <button class="primary" disabled={busy === t.key || !authed} onClick={() => save(t)}>
                    {busy === t.key ? '…' : '+ Save'}
                  </button>
                )
              )}
              <button
                class="delete"
                title="Delete from mixframe (Spotify playlist untouched)"
                onClick={() => {
                  if (t.liked || t.saved) {
                    if (!confirm(`Delete "${t.title}"? It's ${t.liked ? 'liked' : 'saved'}.`)) return
                  }
                  void deleteTrack(t.key)
                }}
              >
                ×
              </button>
            </div>
            {playing === t.key && t.spotify && (
              <div class="player">
                <iframe
                  src={`https://open.spotify.com/embed/track/${t.spotify.id}`}
                  width="100%"
                  height="80"
                  frameBorder="0"
                  allow="encrypted-media"
                />
              </div>
            )}
          </li>
        ))}
        {visible.length === 0 && <li class="empty">Nothing here yet — play gds.fm in a tab.</li>}
      </ul>

      {visible.length > 0 && (
        <div class="pager">
          <label class="page-size">
            Per page
            <select
              value={String(pageSize)}
              onChange={(e) => {
                const v = Number((e.target as HTMLSelectElement).value)
                setPage(0)
                void patchSettings({ pageSize: v }).then(setSettings)
              }}
            >
              {[20, 50, 100].map((n) => (
                <option value={String(n)}>{n}</option>
              ))}
            </select>
          </label>
          {pageCount > 1 && (
            <div class="page-nav">
              <button class="ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                ← Prev
              </button>
              <span class="page-info">
                {safePage + 1} / {pageCount}
              </span>
              <button
                class="ghost"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Next →
              </button>
            </div>
          )}
          <span class="page-total">{visible.length} tracks</span>
        </div>
      )}
    </div>
  )
}
