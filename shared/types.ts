export interface SoundBoardTask {
  context: string;
  mood: 'roast' | 'hype' | 'neutral' | 'calm';
  intensity: 'low' | 'medium' | 'high';
}

export interface HypeProducerTask {
  context: string;
  mood: 'roast' | 'hype' | 'neutral' | 'calm';
  intensity: 'low' | 'medium' | 'high';
}

export interface VisualEffect {
  type: 'confetti' | 'screen_shake' | 'instant_replay' | 'graphic_overlay' | 'zoom_face' | 'chill_filter';
  name: string;
  duration_ms: number;
}

export interface SoundEffect {
  name: string;
  category: string;
}

export type AgentResponse = {
  status: 'executed' | 'skipped' | 'queued';
  reason?: string;
  effect?: string;
};
