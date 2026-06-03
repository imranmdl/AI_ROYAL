import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId:   'com.royaltiles.erp',
  appName: 'Royal ERP',
  webDir:  'dist',
  server: {
    androidScheme: 'https',
    // During local development, point to your local server:
    // url: 'http://192.168.1.100:3000',
    // For production, remove the url line — app uses the Config screen URL
    allowNavigation: ['*'],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration:          2000,
      launchAutoHide:              true,
      backgroundColor:             '#0f172a',
      androidSplashResourceName:   'splash',
      androidScaleType:            'CENTER_CROP',
      showSpinner:                 false,
    },
    StatusBar: {
      style:           'DARK',
      backgroundColor: '#0f172a',
      overlaysWebView: false,
    },
  },
  android: {
    allowMixedContent:            true,
    captureInput:                 true,
    webContentsDebuggingEnabled:  true,   // set false before publishing to Play Store
  },
  ios: {
    contentInset:  'always',
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
