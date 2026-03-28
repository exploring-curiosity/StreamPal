import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import axios from 'axios';
import dotenv from 'dotenv';
import { GoogleGenAI, FunctionDeclaration, Modality } from '@google/genai';

dotenv.config();

interface A2ATask {
  context: string;
  mood: string;
  intensity: string;
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SOUND_BOARD_URL = process.env.SOUND_BOARD_URL || 'http://localhost:3001/tasks';
const HYPE_PRODUCER_URL = process.env.HYPE_PRODUCER_URL || 'http://localhost:3002/tasks';
const PROJECT_ID = process.env.GOOGLE_PROJECT_ID || 'puppet-story-test';
const LOCATION = process.env.GOOGLE_LOCATION || 'us-central1';
const MODEL = 'gemini-live-2.5-flash-native-audio';

// Vertex AI via genAI SDK with ADC (Application Default Credentials)
const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });

// --- Tool Declarations for A2A ---
const triggerSoundDecl: FunctionDeclaration = {
  name: 'trigger_sound_effect',
  description: 'Trigger a sound effect via the Sound Board agent. Use for funny, hype, or cringey moments.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      context: { type: 'string', description: 'What just happened in the stream' },
      mood: { type: 'string', description: 'One of: roast, hype, neutral, calm' },
      intensity: { type: 'string', description: 'One of: low, medium, high' }
    },
    required: ['context', 'mood', 'intensity']
  }
};

const triggerVisualDecl: FunctionDeclaration = {
  name: 'trigger_visual_effect',
  description: 'Trigger a visual overlay via the Hype Producer agent. Use for big visual moments.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      context: { type: 'string', description: 'What just happened in the stream' },
      mood: { type: 'string', description: 'One of: roast, hype, neutral, calm' },
      intensity: { type: 'string', description: 'One of: low, medium, high' }
    },
    required: ['context', 'mood', 'intensity']
  }
};

const SYSTEM_PROMPT = `You are StreamPal, an elite AI Co-Host for live streams.

You WATCH the stream screenshots and provide lightning-fast, high-IQ roasts and hype.

PERSONALITY:
- Sharp, creative, and UNPREDICTABLE.
- NEVER repeat the same roast twice.
- Maximum 8 words. Be extremely punchy.
- No "bruh", "GG", or "sheesh" spam. Use high-tier brainrot slang or dry wit.
- If nothing's happening, stay silent.

CRITICAL: Every reaction must feel like a live human who's actually watching.`;

// --- Per-connection state ---
interface ConnectionState {
  session: any;
  ready: boolean;
  lastReactionTime: number;
  frameCount: number;
  pendingEvents: Array<{ type: string; data: any }>;
}

const sessions = new Map<WebSocket, ConnectionState>();
const MIN_REACTION_GAP_MS = 8000;

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', async (ws: WebSocket) => {
  console.log('[Co-Host] Client connected');

  const state: ConnectionState = {
    session: null,
    ready: false,
    lastReactionTime: 0,
    frameCount: 0,
    pendingEvents: []
  };
  sessions.set(ws, state);

  // Create live session — native audio model for natural voice conversation
  const sessionPromise = ai.live.connect({
    model: MODEL,
    callbacks: {
      onopen: () => {
        console.log('[Co-Host] Live session connected');
      },
      onmessage: (msg: any) => {
        handleLiveMessage(msg, ws, state);
      },
      onerror: (e: any) => {
        console.error('[Co-Host] Live session error:', e?.message || e);
      },
      onclose: (e: any) => {
        console.log('[Co-Host] Live session closed:', e?.code, e?.reason || '');
        state.ready = false;
      }
    },
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: [triggerSoundDecl, triggerVisualDecl] }]
    }
  });

  // Resolve the session promise to get the session handle
  try {
    state.session = await sessionPromise;
    state.ready = true;
    console.log('[Co-Host] Live session ready');

    // Flush any events that arrived before the session was ready
    for (const evt of state.pendingEvents) {
      if (evt.type === 'frame') await handleStreamFrame(evt.data, ws, state);
      else if (evt.type === 'text') handleTextEvent(evt.data, state);
    }
    state.pendingEvents = [];
  } catch (e: any) {
    console.error('[Co-Host] Failed to connect live session:', e.message);
  }

  ws.on('message', async (raw: Buffer) => {
    try {
      const data = JSON.parse(raw.toString());
      console.log(`[Co-Host] Received message type=${data.type} ready=${state.ready} hasSession=${!!state.session}`);

      if (!state.ready || !state.session) {
        // Queue events until the live session is ready
        console.log(`[Co-Host] Queuing event (not ready yet)`);
        if (data.type === 'stream_frame' && data.image) {
          state.pendingEvents.push({ type: 'frame', data: data.image });
        } else if (data.type === 'stream_update' && data.event) {
          state.pendingEvents.push({ type: 'text', data: data.event });
        }
        return;
      }

      if (data.type === 'stream_frame' && data.image) {
        await handleStreamFrame(data.image, ws, state);
      }
      if (data.type === 'stream_update' && data.event) {
        handleTextEvent(data.event, state);
      }
    } catch (e: any) {
      console.error('[Co-Host] Error:', e.message);
    }
  });

  ws.on('close', () => {
    if (state.session) {
      try { state.session.close(); } catch (_) {}
    }
    sessions.delete(ws);
    console.log('[Co-Host] Client disconnected');
  });

  ws.on('error', (err) => {
    console.error('[Co-Host] WebSocket error:', err.message);
  });
});

// --- Handle messages coming back from the live session ---
function handleLiveMessage(msg: any, ws: WebSocket, state: ConnectionState) {
  // Forward audio chunks to frontend
  const parts = msg?.serverContent?.modelTurn?.parts;
  if (parts) {
    for (const part of parts) {
      if (part.inlineData?.data) {
        // Send audio as base64 JSON to frontend
        ws.send(JSON.stringify({
          type: 'co-host-audio',
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType || 'audio/pcm'
        }));
      }
    }
  }

  // Handle function calls
  const calls = msg?.toolCall?.functionCalls;
  if (calls?.length) {
    console.log(`[Co-Host] Function calls: ${calls.map((c: any) => c.name).join(', ')}`);

    // Send tool responses back so the model can continue
    const functionResponses = calls.map((call: any) => ({
      id: call.id,
      name: call.name,
      response: { status: 'dispatched' }
    }));
    try {
      state.session.sendToolResponse({ functionResponses });
    } catch (err: any) {
      console.error('[Co-Host] sendToolResponse error:', err.message);
    }

    // Dispatch A2A tasks in background
    void dispatchA2ATasks(calls, ws);
  }

  // Mark reaction time on turn complete
  if (msg?.serverContent?.turnComplete) {
    state.lastReactionTime = Date.now();
    console.log(`[Co-Host] Turn complete`);
  }
}

async function dispatchA2ATasks(calls: any[], ws: WebSocket) {
  for (const call of calls) {
    const args = call.args || {};
    const task: A2ATask = {
      context: args.context || '',
      mood: args.mood || 'neutral',
      intensity: args.intensity || 'medium'
    };
    if (call.name === 'trigger_sound_effect') {
      const r = await triggerA2ATask('sound', task);
      ws.send(JSON.stringify({ type: 'a2a-result', agent: 'Sound Board', result: r }));
    } else if (call.name === 'trigger_visual_effect') {
      const r = await triggerA2ATask('hype', task);
      ws.send(JSON.stringify({ type: 'a2a-result', agent: 'Hype Producer', result: r }));
    }
  }
}

// --- Send a video frame to the live session ---
async function handleStreamFrame(imageBase64: string, ws: WebSocket, state: ConnectionState) {
  state.frameCount++;
  const now = Date.now();

  if (now - state.lastReactionTime < MIN_REACTION_GAP_MS) return;

  try {
    console.log(`[Co-Host] Sending frame #${state.frameCount}`);

    // Send image as realtime input
    state.session.sendRealtimeInput({
      media: { mimeType: 'image/jpeg', data: imageBase64 }
    });

    // Prompt a reaction
    state.session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: 'React to this stream moment.' }] }],
      turnComplete: true
    });
  } catch (error: any) {
    console.error('[Co-Host] Frame error:', error.message);
  }
}

// --- Send a text event to the live session ---
function handleTextEvent(event: string, state: ConnectionState) {
  try {
    console.log(`[Co-Host] Text event: "${event}"`);
    state.session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: event }] }],
      turnComplete: true
    });
  } catch (error: any) {
    console.error('[Co-Host] Text event error:', error.message);
  }
}

async function triggerA2ATask(agent: 'sound' | 'hype', task: A2ATask) {
  const url = agent === 'sound' ? SOUND_BOARD_URL : HYPE_PRODUCER_URL;
  try {
    console.log(`[Co-Host] A2A → ${agent}: ${JSON.stringify(task)}`);
    const response = await axios.post(url, task, { timeout: 5000 });
    console.log(`[Co-Host] A2A ← ${agent}: ${JSON.stringify(response.data)}`);
    return response.data;
  } catch (error: any) {
    console.error(`[Co-Host] A2A error (${agent}):`, error.message);
    return { status: 'error', reason: error.message };
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'co-host', model: MODEL, project: PROJECT_ID });
});

const server = app.listen(PORT, () => {
  console.log(`[Co-Host] Orchestrator running on port ${PORT}`);
  console.log(`[Co-Host] Vertex AI project=${PROJECT_ID} location=${LOCATION} model=${MODEL}`);
  console.log(`[Co-Host] Sound Board URL: ${SOUND_BOARD_URL}`);
  console.log(`[Co-Host] Hype Producer URL: ${HYPE_PRODUCER_URL}`);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
