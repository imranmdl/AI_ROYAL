# Royal ERP — Mobile App Guide
## Android & iOS via Capacitor

---

## What you need

| Platform | Tool | Download |
|----------|------|----------|
| Android  | Android Studio | https://developer.android.com/studio |
| iOS      | Xcode (Mac only) | Mac App Store |
| Both     | Node.js 18+ | https://nodejs.org |

---

## One-time setup (do this once)

```bash
# 1. Open terminal inside your AI_ROYAL project folder
cd AI_ROYAL

# 2. Run the setup script
bash mobile-setup.sh
```

This installs Capacitor, adds Android & iOS platforms, and builds the app.

---

## Every time you make code changes

```bash
# Rebuild and sync to mobile
npm run mobile:build
```

Then open Android Studio or Xcode to run the updated app.

---

## Build for Android

```bash
# Opens Android Studio
npm run mobile:android
```

Inside Android Studio:
1. Wait for Gradle sync to finish (first time takes ~5 min)
2. Connect your Android phone via USB (enable USB Debugging in Developer Options)
3. Click the ▶ Run button
4. App installs and opens on your phone

**To generate APK for sharing:**
- Build → Build Bundle(s)/APK(s) → Build APK(s)
- APK saved to: `android/app/build/outputs/apk/debug/`

---

## Build for iOS (Mac only)

```bash
# Opens Xcode
npm run mobile:ios
```

Inside Xcode:
1. Select your iPhone from the device dropdown at the top
2. Click the ▶ Play button
3. First time: go to Settings → General → VPN & Device Management → Trust your developer

**For App Store / TestFlight:**
- Requires Apple Developer account (₹8,000/year)
- Product → Archive → Distribute App

---

## IMPORTANT: Server URL setup on the phone

The app needs to connect to your backend server.

**Option A — Use your deployed server (recommended for production):**
1. Deploy your server to Railway / Render / VPS (already done?)
2. Open the app → Login screen → "Config" button
3. Enter your server URL: `https://your-server.com`
4. Tap Save & Reconnect

**Option B — Use local server on same WiFi (for testing):**
1. Find your computer's local IP: `ipconfig` (Windows) or `ifconfig` (Mac)
2. Start your server: `node server.js`
3. In the app Config: enter `http://192.168.1.XXX:3000`
4. In `capacitor.config.ts`, uncomment: `url: 'http://192.168.1.XXX:3000'`

---

## Features that work on mobile

| Feature | Android | iOS |
|---------|---------|-----|
| Full ERP (all modules) | ✅ | ✅ |
| Login / multi-user | ✅ | ✅ |
| Inventory management | ✅ | ✅ |
| Quotation & Invoice | ✅ | ✅ |
| WhatsApp share | ✅ | ✅ |
| Print to PDF | ✅ | ✅ |
| Camera (product images) | ✅ | ✅ |
| Offline (in-memory) | ✅ | ✅ |
| Push notifications | ✅ (add later) | ✅ (add later) |

---

## Publish to Google Play Store

1. In Android Studio: Build → Generate Signed Bundle/APK → Android App Bundle (.aab)
2. Create keystore when prompted (save this file securely — you need it forever)
3. Go to https://play.google.com/console
4. Create app → Upload .aab file
5. Fill in store listing → Publish
6. Cost: one-time $25 registration fee

## Publish to Apple App Store

1. Enroll in Apple Developer Program: https://developer.apple.com/enroll
   (₹8,000/year)
2. In Xcode: Product → Archive
3. Upload to App Store Connect
4. Submit for review (1-3 days)

---

## Troubleshooting

**"Network Error" on phone:**
→ Your phone can't reach the server. Set the server URL in Config.

**App shows blank screen:**
→ Run `npm run mobile:build` again, then `npx cap sync`

**Android build fails:**
→ In Android Studio: File → Sync Project with Gradle Files

**iOS "Untrusted Developer":**
→ iPhone Settings → General → VPN & Device Management → Trust your certificate

**WhatsApp not opening:**
→ WhatsApp must be installed on the device. The share link opens it automatically.

