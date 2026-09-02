import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  // pins the extension ID (gagmjkojhannamjghpfikoaldghlnmii) on every install — one Spotify redirect URI for everyone
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6M3y/GLmSNhrldaTYNSZHX4jXrRm1iiGRbGBaqdNXUIw8+JwtcOdnX23jKzpZcs6ddxuKIDOAGOvY4Q48r4VUzaujYC9QrlHNEWSxpKdXAMXnOixNgFx0n3rWmMaV50/nAY3eCTyw7TjNiGYAzfRvtmPaQT8vqG3P5c4XIxBB1Y/3jkVj3FI3FCRvYTcskf5TqqcF+J9GO8ySTtg+O+EEg7DdhmDoQYgZhti98AdIcNyHOH6cNR9c4Iiv2m2JIoPy3B3X2ZVpvEowhfRyalbTQFGlFux8Gtkzh52whtNAzijOMFxKSLRG6u6FmIjGHHWxISMx2Qyo+opFp46WUQyJQIDAQAB',
  manifest_version: 3,
  name: 'mixframe',
  description: 'Captures tracks you hear on gds.fm and saves the keepers to Spotify.',
  version: '0.1.0',
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'mixframe',
    default_icon: {
      '16': 'icons/record-idle-16.png',
      '48': 'icons/record-idle-48.png',
      '128': 'icons/record-idle-128.png',
    },
  },
  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },
  permissions: ['tabs', 'storage', 'alarms', 'identity'],
  host_permissions: [
    'https://live.gds.fm/*',
    'https://api.spotify.com/*',
    'https://accounts.spotify.com/*',
  ],
  icons: {
    '16': 'icons/record-live-16.png',
    '48': 'icons/record-live-48.png',
    '128': 'icons/record-live-128.png',
  },
})
