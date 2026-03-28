import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const SOUND_LIBRARY = [
  { name: 'airhorn', category: 'hype' },
  { name: 'sad_trombone', category: 'roast' },
  { name: 'bruh', category: 'roast' },
  { name: 'vine_boom', category: 'roast' },
  { name: 'crickets', category: 'roast' },
  { name: 'crowd_cheer', category: 'hype' },
  { name: 'fail_horn', category: 'roast' },
  { name: 'dramatic_reverb', category: 'neutral' },
  { name: 'mlg_hitmarker', category: 'hype' },
  { name: 'emotional_damage', category: 'roast' }
];

let lastPlayedTime = 0;
const COOLDOWN_MS = 3000;
const PLAY_CHANCE = 0.5; // Only play ~50% of the time

// --- SSE Clients ---
let clients: Array<{ id: number; res: express.Response }> = [];

app.get('/events', (req: express.Request, res: express.Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  clients.push({ id: clientId, res });
  console.log(`[Sound Board] SSE client connected (${clients.length} total)`);

  req.on('close', () => {
    clients = clients.filter(c => c.id !== clientId);
    console.log(`[Sound Board] SSE client disconnected (${clients.length} total)`);
  });
});

const broadcastSound = (sound: string) => {
  const payload = `data: ${JSON.stringify({ type: 'sound', name: sound })}\n\n`;
  console.log(`[Sound Board] Broadcasting sound: ${sound} to ${clients.length} clients`);
  clients.forEach(c => c.res.write(payload));
};

function pickSound(mood: string): string | null {
  // Skip randomly to avoid playing every single time
  if (Math.random() > PLAY_CHANCE) return null;

  const matching = SOUND_LIBRARY.filter(s => s.category === mood);
  const pool = matching.length > 0 ? matching : SOUND_LIBRARY;
  return pool[Math.floor(Math.random() * pool.length)].name;
}

app.post('/tasks', (req: express.Request, res: express.Response) => {
  const task = req.body;
  const now = Date.now();
  const timeSinceLastPlay = now - lastPlayedTime;

  console.log(`[Sound Board] Received task: ${JSON.stringify(task)}`);

  if (timeSinceLastPlay < COOLDOWN_MS) {
    const msg = `Cooldown active (${Math.ceil((COOLDOWN_MS - timeSinceLastPlay) / 1000)}s remaining)`;
    console.log(`[Sound Board] Skipped: ${msg}`);
    res.json({ status: 'skipped', reason: msg });
    return;
  }

  const sound = pickSound(task.mood || 'neutral');

  if (sound) {
    lastPlayedTime = now;
    broadcastSound(sound);
    console.log(`[Sound Board] Playing: ${sound}`);
    res.json({ status: 'executed', effect: sound });
  } else {
    console.log(`[Sound Board] Skipped (random chance)`);
    res.json({ status: 'skipped', reason: 'Random skip' });
  }
});

app.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', agent: 'sound-board', sounds: SOUND_LIBRARY.length, cooldown: COOLDOWN_MS });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[Sound Board] Agent running on port ${PORT}`);
  console.log(`[Sound Board] ${SOUND_LIBRARY.length} sounds loaded, ${COOLDOWN_MS}ms cooldown, ${PLAY_CHANCE * 100}% play chance`);
});
