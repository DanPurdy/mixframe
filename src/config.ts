/**
 * Default Spotify app client ID baked into the published build.
 * Public by design (PKCE — no secret). Users on the shared app must be
 * allowlisted in the Spotify dashboard while it's in development mode (25 max);
 * anyone can override with their own client ID in settings.
 */
export const DEFAULT_SPOTIFY_CLIENT_ID = '97739e31d8d1481fb191be596d758c6a'
