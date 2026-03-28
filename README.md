# StreamPal — AI Co-Host for Live Streams

An AI-powered live stream co-host system built with three autonomous agents that watch your stream, react with voice commentary, trigger sound effects, and fire visual overlays — all in real time.

**Built by Sudharshan Ramesh & Tanish**

## Architecture

StreamPal runs as a multi-agent system where each agent has a distinct role and communicates via A2A (Agent-to-Agent) task delegation:

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│   Frontend   │◄──────────────────►│  Agent 1: Co-Host │
│  (React/Vite)│                    │  (Gemini Live API)│
└──────┬───────┘                    └────┬────────┬─────┘
       │                                │ A2A    │ A2A
       │ SSE                            ▼        ▼
       │                    ┌───────────────┐  ┌─────────────────┐
       ├───────────────────►│ Agent 2:      │  │ Agent 3:        │
       │                    │ Sound Board   │  │ Hype Producer   │
       └───────────────────►│               │  │                 │
                            └───────────────┘  └─────────────────┘
```

### Agent 1 — The Co-Host

The star of the show. Runs on **Gemini Flash Live** via the **Live API**.

- Receives continuous video frames (1-2 FPS) and stream events through a persistent WebSocket
- Personality-prompted as a witty, sarcastic co-host who roasts bad plays, hypes good ones, and comments on what the streamer is doing
- **Speaks back via Gemini Live native audio output** — the streamer and audience hear it directly
- When it decides a sound effect or visual effect would land, it fires a **function call** that triggers an A2A task to the Sound Board or Hype Producer. It does NOT play sounds itself — it delegates
- Uses **proactive audio** to control when it speaks. Doesn't talk over the streamer — waits for natural pauses or reacts to clear moments (mistakes, wins, awkward silences)
- Uses **affective dialog** to match the streamer's energy — excited when they're excited, deadpan when they're being boring

### Agent 2 — The Sound Board

Receives A2A tasks from the Co-Host: *"play a sound effect for this context."*

- Does NOT blindly play what the Co-Host asks. It has its own logic:
  - Manages a **cooldown** (no sound spam — minimum gap between effects)
  - **Picks the best sound** from its library based on context (Co-Host says "embarrassing moment" → Sound Board decides between sad trombone, crickets, or "bruh")
  - Can **refuse**: *"I just played a sound 3 seconds ago, skipping"*
- Pushes the chosen sound to the frontend via **SSE**. Frontend plays it through **Web Audio API**
- Sound library: airhorn, sad trombone, bruh, vine boom, crickets, crowd cheer, fail horn, dramatic reverb, MLG hitmarker, emotional damage

### Agent 3 — The Hype Producer

Receives A2A tasks from the Co-Host for visual moments.

- Manages **visual overlays** on the stream view:
  - Confetti burst (hype moments)
  - Screen shake (big plays)
  - "L" or "W" graphic overlays
  - Zoom-in on facecam (embarrassing moments)
- Has its own **pacing logic**:
  - Doesn't stack effects (one visual at a time)
  - Tracks the **energy level** of the stream — escalates if hype is building, pulls back if calm
  - Can **refuse**: *"We just did confetti 20 seconds ago, too soon"*
- Pushes visual commands to the frontend via **SSE**. Frontend renders them as CSS animations/overlays

## Tech Stack

- **Co-Host**: Gemini Live API (native audio), `@google/genai` SDK, Vertex AI, Express + WebSocket
- **Sound Board / Hype Producer**: Express, SSE (Server-Sent Events)
- **Frontend**: React 19, Vite, Tailwind CSS, Web Audio API
- **Deployment**: Google Cloud Run (4 services)
- **Communication**: WebSocket (frontend ↔ co-host), HTTP A2A (co-host → agents), SSE (agents → frontend)

## Getting Started

### Prerequisites

- Node.js 20+
- Google Cloud project with Vertex AI enabled
- `gcloud` CLI authenticated (`gcloud auth application-default login`)

### Local Development

```bash
# Install dependencies
npm install
cd agents/co-host && npm install
cd ../sound-board && npm install
cd ../hype-producer && npm install
cd ../../frontend && npm install

# Set up environment
cp .env.example .env
# Edit .env with your GOOGLE_PROJECT_ID

# Run all services
npm run dev
```

### Deploy to Google Cloud Run

```bash
PROJECT=your-gcp-project
REGION=us-central1

# 1. Deploy backend agents
gcloud run deploy sound-board --source agents/sound-board --region $REGION --allow-unauthenticated \
  --set-env-vars GOOGLE_PROJECT_ID=$PROJECT

gcloud run deploy hype-producer --source agents/hype-producer --region $REGION --allow-unauthenticated \
  --set-env-vars GOOGLE_PROJECT_ID=$PROJECT

# 2. Deploy co-host (needs agent URLs)
SOUND_URL=$(gcloud run services describe sound-board --region $REGION --format 'value(status.url)')
HYPE_URL=$(gcloud run services describe hype-producer --region $REGION --format 'value(status.url)')

gcloud run deploy co-host --source agents/co-host --region $REGION --allow-unauthenticated \
  --set-env-vars GOOGLE_PROJECT_ID=$PROJECT,SOUND_BOARD_URL=${SOUND_URL}/tasks,HYPE_PRODUCER_URL=${HYPE_URL}/tasks \
  --session-affinity

# 3. Deploy frontend (needs all URLs)
CO_HOST_URL=$(gcloud run services describe co-host --region $REGION --format 'value(status.url)')

gcloud run deploy frontend --source frontend --region $REGION --allow-unauthenticated \
  --set-build-env-vars VITE_CO_HOST_WS_URL=wss://${CO_HOST_URL#https://},VITE_SOUND_BOARD_URL=$SOUND_URL,VITE_HYPE_PRODUCER_URL=$HYPE_URL
```

## Usage

1. Open the frontend URL in your browser
2. Click **Load Video** to upload a video file
3. Press play — the AI Co-Host starts watching and reacting
4. Watch the **Agent Activity** sidebar for real-time logs of all agent decisions
