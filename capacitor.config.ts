import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId:   'com.royaltiles.erp',
  appName: 'Royal ERP',
  webDir:  'dist',
  server: {
    // Points to your live Railway server — app always uses this
    url:           'https://pretty-stillness-production-cf79.up.railway.app',
    androidScheme: 'https',
    allowNavigation: ['*.up.railway.app', 'railway.app'],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration:        2500,
      launchAutoHide:            true,
      backgroundColor:           '#0f172a',
      androidSplashResourceName: 'splash',
      androidScaleType:          'CENTER_CROP',
      showSpinner:               false,
    },
    StatusBar: {
      style:           'DARK',
      backgroundColor: '#0f172a',
      overlaysWebView: false,
    },
  },
  android: {
    allowMixedContent:           false,
    captureInput:                true,
    webContentsDebuggingEnabled: false,
    // Deep link: when user scans QR and opens royalerp:// link, app handles it
    appendUserAgent: 'RoyalERP-Android/1.0',
  },
  ios: {
    contentInset:  'always',
    scrollEnabled: true,
    appendUserAgent: 'RoyalERP-iOS/1.0',
  },
};

export default config;
