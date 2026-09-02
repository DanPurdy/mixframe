import type { AuthState, SpotifyMatch } from '../types'
import { getAuth, setAuth, getSettings, patchSettings } from './storage'
import { DEFAULT_SPOTIFY_CLIENT_ID } from '../config'

/** settings override wins; baked-in default otherwise */
export async function effectiveClientId(): Promise<string> {
  const { clientId } = await getSettings()
  return clientId || DEFAULT_SPOTIFY_CLIENT_ID
}

const SCOPES = 'playlist-modify-private playlist-modify-public playlist-read-private'
export const DEFAULT_PLAYLIST_NAME = 'GDS finds'

// ---------- PKCE ----------

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

export function redirectUri(): string {
  return chrome.identity.getRedirectURL()
}

export async function login(): Promise<void> {
  const clientId = await effectiveClientId()
  if (!clientId) throw new Error('Set your Spotify client ID first (review page → settings).')
  const { verifier, challenge } = await pkcePair()
  const authUrl = new URL('https://accounts.spotify.com/authorize')
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  }).toString()

  const cbUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true })
  if (!cbUrl) throw new Error('Auth cancelled')
  const code = new URL(cbUrl).searchParams.get('code')
  if (!code) throw new Error('No auth code returned')

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  })
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`)
  const tok = await res.json()
  await setAuth({
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
  })
}

export async function logout(): Promise<void> {
  await setAuth(null)
}

async function freshToken(): Promise<string | null> {
  let auth = await getAuth()
  if (!auth) return null
  if (Date.now() < auth.expiresAt - 60_000) return auth.accessToken
  const clientId = await effectiveClientId()
  if (!clientId) return null
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
      client_id: clientId,
    }),
  })
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) await setAuth(null)
    return null
  }
  const tok = await res.json()
  const next: AuthState = {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + tok.expires_in * 1000,
  }
  await setAuth(next)
  return next.accessToken
}

export async function isAuthed(): Promise<boolean> {
  return (await getAuth()) !== null
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const token = await freshToken()
  if (!token) throw new Error('Not connected to Spotify')
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  })
  if (res.status === 204) return null
  if (!res.ok) throw new Error(`Spotify ${init?.method ?? 'GET'} ${path.split('?')[0]} → ${res.status}: ${await res.text()}`)
  return res.json()
}

// ---------- matching ----------

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '') // strip (feat. …), [remaster] noise
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export async function searchTrack(artist: string, title: string): Promise<SpotifyMatch | null> {
  // "(feat. …)" suffixes tank fielded search precision — strip for the query, keep for confidence check
  const bareTitle = title.replace(/\s*[([].*?[)\]]\s*/g, ' ').trim() || title
  const q = `artist:"${artist}" track:"${bareTitle}"`
  let items = (await api(`/search?${new URLSearchParams({ q, type: 'track', limit: '3' })}`)).tracks
    ?.items as any[]
  if (!items?.length) {
    items = (
      await api(`/search?${new URLSearchParams({ q: `${artist} ${title}`, type: 'track', limit: '3' })}`)
    ).tracks?.items
  }
  const top = items?.[0]
  if (!top) return null
  const gotArtists = top.artists.map((a: any) => a.name).join(', ')
  const confidence: SpotifyMatch['confidence'] =
    norm(top.name) === norm(title) && top.artists.some((a: any) => norm(a.name) === norm(artist))
      ? 'high'
      : 'low'
  return {
    id: top.id,
    uri: top.uri,
    name: top.name,
    artists: gotArtists,
    url: top.external_urls?.spotify ?? `https://open.spotify.com/track/${top.id}`,
    image: top.album?.images?.[2]?.url ?? top.album?.images?.[0]?.url,
    confidence,
  }
}

// ---------- playlist ----------

async function ensurePlaylist(): Promise<string> {
  const settings = await getSettings()
  if (settings.playlistId) return settings.playlistId
  const name = settings.playlistName?.trim() || DEFAULT_PLAYLIST_NAME

  // look for an existing playlist by name among the user's own
  const me = await api('/me')
  let url = '/me/playlists?limit=50'
  while (url) {
    const page = await api(url)
    const found = page.items?.find((p: any) => p.name === name && p.owner?.id === me.id)
    if (found) {
      await patchSettings({ playlistId: found.id, playlistName: name })
      return found.id
    }
    url = page.next ? page.next.replace('https://api.spotify.com/v1', '') : ''
  }

  // POST /users/{id}/playlists was removed in Spotify's Feb 2026 migration — /me/playlists is the replacement
  const created = await api('/me/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      public: false,
      description: 'Tracks heard on gds.fm, captured by mixframe',
    }),
  })
  await patchSettings({ playlistId: created.id, playlistName: name })
  return created.id
}

export async function saveToPlaylist(uri: string): Promise<void> {
  const playlistId = await ensurePlaylist()
  // /tracks became /items in Spotify's Feb 2026 migration
  await api(`/playlists/${playlistId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri] }),
  })
}

export function searchUrl(artist: string, title: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${title}`)}`
}
