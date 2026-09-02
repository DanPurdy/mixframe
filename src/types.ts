export interface SpotifyMatch {
  id: string
  uri: string
  name: string
  artists: string
  url: string
  image?: string
  confidence: 'high' | 'low'
}

export interface TrackEntry {
  key: string
  artist: string
  title: string
  album?: string
  year?: string
  genre?: string
  isSet?: boolean
  /** play timestamps (ms epoch), newest last */
  plays: number[]
  /** undefined = not yet searched; null = searched, no result */
  spotify?: SpotifyMatch | null
  saved?: boolean
  savedAt?: number
  /** local favourite — kept through pruning even without a Spotify match */
  liked?: boolean
  likedAt?: number
}

export type TrackMap = Record<string, TrackEntry>

export interface NowPlaying {
  key: string
  artist: string
  title: string
  isSet: boolean
  show?: string
  startedAt: number
  endsInMs: number
}

export interface AuthState {
  accessToken: string
  refreshToken: string
  /** ms epoch when access token expires */
  expiresAt: number
}

export interface Settings {
  clientId?: string
  playlistId?: string
  playlistName?: string
  /** days to keep unsaved tracks; 'never' disables pruning. Default 7. */
  pruneDays?: number | 'never'
  /** review page rows per page. Default 20. */
  pageSize?: number
}

export interface StorageUsage {
  bytesInUse: number
  quotaBytes: number
  /** 0..1 */
  ratio: number
  /** capture blocked until user prunes */
  full: boolean
}
