# YUNAY — Webapp Clone Engine

Webapp reverse engineering dashboard: kisi bhi URL ko scan karo, ZIP/APK analyze karo, aur reconstruction build karke preview dekho.

## Features

- **Website scan** — Puppeteer se live page render, tech stack detect, screenshot, assets aur API calls capture.
- **ZIP analysis** — Project ka file tree, dependencies aur tech stack.
- **APK analysis** — Manifest, permissions, framework (Flutter / React Native / Capacitor / Cordova) aur extracted web assets.
- **Reconstruction** — Scan report se naya project `workspace/reconstructed/` me generate hota hai.
- **Dashboard** — `http://localhost:4000/` par browser UI (scan, upload, preview).
- **Android APK** — GitHub Actions workflow `.github/workflows/build-apk.yml` push par APK build karta hai.

## Quick start

```bash
npm install
cp .env.example .env   # agar available ho
npm start
```

Open: `http://localhost:4000/`

Requirements: Node.js 18+ aur Chromium (`/usr/bin/chromium`).
Scanner default `executablePath` yahi use karta hai — alag path ho to `src/services/scanner.js` me badlo.

## Scripts

| Script | Kaam |
|---|---|
| `npm start` | Backend + dashboard start |
| `npm run dev` | Watch mode |
| `npm run build` | Syntax check + deployable `dist/` bundle |
| `npm run check` | Sirf syntax check |

## API

| Method | Endpoint | Body |
|---|---|---|
| GET | `/api/status` | — |
| POST | `/api/scan-url` | `{ "url": "https://example.com" }` |
| POST | `/api/analyze-zip` | `multipart/form-data` field `file` |
| POST | `/api/analyze-apk` | `multipart/form-data` field `file` |
| POST | `/api/ai/chat` | `{ "prompt": "..." }` |
| POST | `/api/reconstruct` | `{ reaContext, prompt, projectName }` |

Generated builds: `GET /preview/<buildId>/index.html`

## Environment

`.env` me AI provider configure hota hai:

```env
PORT=4000
AI_PROVIDER=groq        # groq | gemini | openrouter | local
GROQ_API_KEY=
GEMINI_API_KEY=
OPENROUTER_API_KEY=
LOCAL_LLM_URL=
```

Keys khaali hain to AI calls local fallback blueprint return karti hain (reconstruction generic template banata hai).

## Android build

`.github/workflows/build-apk.yml` `main` push ya manual dispatch par chalta hai:

- Capacitor Android project generate karta hai
- `assembleDebug` se APK build karta hai
- artifact + `latest` release par APK publish karta hai

## Known limitations

- Scanner single page scan karta hai; multi-page crawl / asset mirroring abhi nahi hai.
- AI keys ke bina reconstruction generic template hota hai.
- Scanner heavy JS sites par timeout kar sakta hai (`networkidle2`, 45s).
