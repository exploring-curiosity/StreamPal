# StreamPal — AI Co-Host for Live Streams

A multi-agent AI system that watches your live stream and reacts in real time — roasting bad plays, hyping victories, triggering sound effects, and firing visual overlays. Three autonomous agents coordinate via A2A (Agent-to-Agent) communication to create a fully automated co-host experience.

**Built by Sudharshan Ramesh & Tanish**

## How It Works

```
┌─────────────┐     WebSocket (video + audio)     ┌──────────────────────────┐
│             │◄──────────────────────────────────►│   Agent 1: Co-Host       │
│  Frontend   │                                    │   Gemini Live API        │
│  (React)    │◄─── SSE (sound triggers) ─────────│──── A2A ──►┌────────────┐│
│             │◄─── SSE (visual triggers) ────────│──── A2A ──►│Sound Board ││
│             │                                    │            │Hype Producer│
└─────────────┘                                    └────────────└────────────┘┘
```

1. **Frontend** captures video frames at ~1 FPS and streams them over WebSocket to the Co-Host
2. **Co-Host** (Gemini Live API) watches the frames, decides when to react, and speaks back with native AI-generated voice
3. When the Co-Host decides a moment needs a sound effect or visual, it fires a **function call** that becomes an **A2A task** to the Sound Board or Hype Producer
4. Sound Board and Hype Producer have their own pacing logic — cooldowns, energy tracking, and the ability to refuse if effects are too frequent
5. Effects are pushed to the frontend via **SSE** and rendered as Web Audio / CSS animations

## The Three Agents

### Agent 1 — The Co-Host (Orchestrator)
- Runs on **Gemini Live API** with **native audio output** — speaks with a real AI voice, not TTS
- Receives continuous video frames through a persistent WebSocket connection
- Personality-prompted as a witty, sarcastic co-host: roasts bad plays, hypes good ones, reacts to what the streamer does and says
- Uses **proactive audio** — waits for natural pauses, doesn't talk over the streamer
- Delegates all sound/visual effects via function calls to the other agents

### Agent 2 — The Sound Board
- Receives A2A tasks from the Co-Host with context about what just happened
- Has its own decision-making: picks the best sound from its library based on mood (roast, hype, neutral)
- Enforces cooldowns to prevent sound spam
- Can refuse requests if a sound was just played
- Library: airhorn, sad trombone, bruh, vine boom, crickets, crowd cheer, fail horn, dramatic reverb, MLG hitmarker, emotional damage

### Agent 3 — The Hype Producer
- Receives A2A tasks from the Co-Host for visual moments
- Manages overlays: confetti bursts, screen shake, "L" / "W" graphic overlays, zoom effects
- Tracks stream energy level — escalates effects when hype builds, pulls back when things are calm
- Enforces pacing: one visual at a time, minimum intervals between effects

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **AI Model** | Gemini Flash Live (native audio) via Live API |
| **AI SDK** | `@google/genai` TypeScript SDK with Vertex AI |
| **Agent Communication** | A2A over HTTP, function calling for delegation |
| **Co-Host Server** | Node.js, Express, WebSocket (`ws`) |
| **Sound Board / Hype Producer** | Node.js, Express, Server-Sent Events (SSE) |
| **Frontend** | React 19, Vite, Tailwind CSS, Web Audio API |
| **Audio Playback** | Raw PCM streaming at 24kHz via Web Audio API |
| **Deployment** | Google Cloud Run (4 services) |
| **Auth** | Google Cloud Application Default Credentials (ADC) |

## Deploy to Google Cloud Run

```bash
PROJECT=your-gcp-project
REGION=us-central1

# 1. Deploy backend agents
gcloud run deploy sound-board --source agents/sound-board --region $REGION \
  --allow-unauthenticated --set-env-vars GOOGLE_PROJECT_ID=$PROJECT

gcloud run deploy hype-producer --source agents/hype-producer --region $REGION \
  --allow-unauthenticated --set-env-vars GOOGLE_PROJECT_ID=$PROJECT

# 2. Deploy co-host with agent URLs
SOUND_URL=$(gcloud run services describe sound-board --region $REGION --format 'value(status.url)')
HYPE_URL=$(gcloud run services describe hype-producer --region $REGION --format 'value(status.url)')

gcloud run deploy co-host --source agents/co-host --region $REGION \
  --allow-unauthenticated --session-affinity \
  --set-env-vars GOOGLE_PROJECT_ID=$PROJECT,SOUND_BOARD_URL=${SOUND_URL}/tasks,HYPE_PRODUCER_URL=${HYPE_URL}/tasks

# 3. Deploy frontend with all backend URLs
CO_HOST_URL=$(gcloud run services describe co-host --region $REGION --format 'value(status.url)')

gcloud run deploy frontend --source frontend --region $REGION --allow-unauthenticated \
  --set-build-env-vars VITE_CO_HOST_WS_URL=wss://${CO_HOST_URL#https://},VITE_SOUND_BOARD_URL=$SOUND_URL,VITE_HYPE_PRODUCER_URL=$HYPE_URL
```

## Local Development

```bash
npm install && cd agents/co-host && npm install && cd ../sound-board && npm install && cd ../hype-producer && npm install && cd ../../frontend && npm install && cd ..

cp .env.example .env  # Set GOOGLE_PROJECT_ID

npm run dev  # Starts all 4 services
```

Open the frontend, upload a video, hit play — the AI co-host starts watching and reacting.
