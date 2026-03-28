import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

interface VisualEffect {
  type: string;
  name: string;
  duration_ms: number;
}

const app = express();
app.use(cors());
app.use(express.json());

const PROJECT_ID = process.env.GOOGLE_PROJECT_ID || 'gdg-nyu-hackathon';
const MODEL = '';

const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: 'global' });
console.log(`[Hype Producer] Using Vertex AI project=${PROJECT_ID} location=global model=${MODEL}`);

const VISUAL_EFFECTS: VisualEffect[] = [
  { type: 'confetti', name: 'Confetti Burst', duration_ms: 3000 },
  { type: 'screen_shake', name: 'Intense Shake', duration_ms: 1000 },
  { type: 'graphic_overlay_w', name: 'W Graphic', duration_ms: 3000 },
  { type: 'graphic_overlay_l', name: 'L Graphic', duration_ms: 3000 },
  { type: 'zoom_face', name: 'Zoom In', duration_ms: 2000 },
];

let lastEffectTime = 0;
const MIN_INTERVAL_MS = 10000;
let currentEnergy = 50;

// --- SSE Clients ---
let clients: Array<{ id: number; res: express.Response }> = [];

app.get('/events', (req: express.Request, res: express.Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  clients.push({ id: clientId, res });
  console.log(`[Hype Producer] SSE client connected (${clients.length} total)`);

  req.on('close', () => {
    clients = clients.filter(c => c.id !== clientId);
    console.log(`[Hype Producer] SSE client disconnected (${clients.length} total)`);
  });
});

const broadcastVisual = (effect: VisualEffect) => {
  const payload = `data: ${JSON.stringify({ type: 'visual', effect })}\n\n`;
  console.log(`[Hype Producer] Broadcasting visual: ${effect.type} to ${clients.length} clients`);
  clients.forEach(c => c.res.write(payload));
};

app.post('/tasks', async (req: express.Request, res: express.Response) => {
  const task = req.body;
  const now = Date.now();
  const timeSinceLastEffect = now - lastEffectTime;

  console.log(`[Hype Producer] Received task: ${JSON.stringify(task)}`);

  if (timeSinceLastEffect < MIN_INTERVAL_MS) {
    const msg = `Cooldown active (${Math.ceil((MIN_INTERVAL_MS - timeSinceLastEffect) / 1000)}s remaining)`;
    console.log(`[Hype Producer] Skipped: ${msg}`);
    res.json({ status: 'skipped', reason: msg });
    return;
  }

  // Adjust energy based on mood
  if (task.mood === 'hype') currentEnergy = Math.min(100, currentEnergy + 15);
  else if (task.mood === 'calm') currentEnergy = Math.max(0, currentEnergy - 10);

  try {
    const effectNames = VISUAL_EFFECTS.map(v => v.type).join(', ');
    const prompt = `You are the Hype Producer for a live stream co-host show.
Current Energy Level: ${currentEnergy}/100.
Available effects: ${effectNames}.

Context: "${task.context || 'unknown'}"
Mood: ${task.mood || 'neutral'}
Intensity: ${task.intensity || 'medium'}

Pick the SINGLE best visual effect type. Respond with ONLY the exact type name (e.g., "confetti" or "screen_shake"). If nothing fits, respond "none".`;

    const result = await ai.models.generateContent({ model: MODEL, contents: prompt });
    const raw = result.text || '';
    const responseText = raw.trim().toLowerCase().replace(/[^a-z_]/g, '');
    console.log(`[Hype Producer] Gemini picked: "${responseText}"`);

    const selectedEffect = VISUAL_EFFECTS.find(v => responseText.includes(v.type));

    if (selectedEffect) {
      lastEffectTime = now;
      broadcastVisual(selectedEffect);
      console.log(`[Hype Producer] Triggering: ${selectedEffect.name} (${selectedEffect.duration_ms}ms)`);
      res.json({ status: 'executed', effect: selectedEffect.type });
    } else {
      console.log(`[Hype Producer] No match for "${responseText}"`);
      res.json({ status: 'skipped', reason: `No match for "${responseText}"` });
    }
  } catch (error: any) {
    console.error('[Hype Producer] Gemini error:', error.message);
    res.status(500).json({ status: 'error', reason: error.message });
  }
});

app.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', agent: 'hype-producer', effects: VISUAL_EFFECTS.length, energy: currentEnergy });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`[Hype Producer] Agent running on port ${PORT}`);
  console.log(`[Hype Producer] ${VISUAL_EFFECTS.length} effects loaded, energy: ${currentEnergy}`);
});
