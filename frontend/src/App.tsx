import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Monitor, MessageSquare, Zap, Upload } from 'lucide-react';
import confetti from 'canvas-confetti';

const FRAME_INTERVAL_MS = 5000;
const SUBTITLE_CLEAR_MS = 6000;
const AUDIO_SAMPLE_RATE = 24000; // Gemini Live native audio is 24kHz PCM

// Backend URLs — configurable via VITE_ env vars for Cloud Run deployment
const CO_HOST_WS_URL = import.meta.env.VITE_CO_HOST_WS_URL || 'ws://localhost:3000';
const SOUND_BOARD_URL = import.meta.env.VITE_SOUND_BOARD_URL || 'http://localhost:3001';
const HYPE_PRODUCER_URL = import.meta.env.VITE_HYPE_PRODUCER_URL || 'http://localhost:3002';

const App: React.FC = () => {
  const [testVideoUrl, setTestVideoUrl] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<string>('');
  const [activity, setActivity] = useState<{agent: string, action: string, time: string}[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coHostWs = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subtitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);

  const addActivity = useCallback((agent: string, action: string) => {
    setActivity(prev => [{ agent, action, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 20));
  }, []);

  // --- Play PCM audio from Gemini Live native audio ---
  const playPcmAudio = useCallback((base64Data: string) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: AUDIO_SAMPLE_RATE });
    }
    const ctx = audioContextRef.current;

    // Decode base64 to Int16 PCM
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);

    // Convert Int16 PCM to Float32 for Web Audio
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const buffer = ctx.createBuffer(1, float32.length, AUDIO_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    // Duck video audio while co-host is speaking
    if (videoRef.current) videoRef.current.volume = 0.15;

    // Schedule seamless playback
    const now = ctx.currentTime;
    const startTime = Math.max(now, nextPlayTimeRef.current);
    nextPlayTimeRef.current = startTime + buffer.duration;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(startTime);

    source.onended = () => {
      // Restore video volume when no more audio is queued
      if (ctx.currentTime >= nextPlayTimeRef.current - 0.05) {
        if (videoRef.current) videoRef.current.volume = 1.0;
      }
    };
  }, []);

  // --- Capture a video frame as base64 JPEG ---
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.paused || video.ended) return null;

    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, 640, 360);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    return dataUrl.split(',')[1]; // base64 only
  }, []);

  // --- Send frame to Co-Host for autonomous analysis ---
  const sendFrameToCoHost = useCallback(() => {
    if (!coHostWs.current || coHostWs.current.readyState !== WebSocket.OPEN) return;
    const base64 = captureFrame();
    if (!base64) return;

    coHostWs.current.send(JSON.stringify({
      type: 'stream_frame',
      image: base64,
      timestamp: Date.now()
    }));
  }, [captureFrame]);

  // --- Start autonomous frame capture loop ---
  const startFrameCapture = useCallback(() => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    // Send first frame after a short delay
    setTimeout(() => sendFrameToCoHost(), 2000);
    frameIntervalRef.current = setInterval(sendFrameToCoHost, FRAME_INTERVAL_MS);
    setIsAnalyzing(true);
    addActivity('System', 'Co-Host is now watching the stream...');
  }, [sendFrameToCoHost, addActivity]);

  const stopFrameCapture = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    setIsAnalyzing(false);
  }, []);

  // --- WebSocket + SSE setup ---
  useEffect(() => {
    const ws = new WebSocket(CO_HOST_WS_URL);
    coHostWs.current = ws;

    ws.onopen = () => addActivity('System', 'Connected to Co-Host');

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'co-host-audio' && data.data) {
        playPcmAudio(data.data);
        // Show speaking indicator
        setSubtitles('🎙️ Co-Host is speaking...');
        if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current);
        subtitleTimerRef.current = setTimeout(() => setSubtitles(''), SUBTITLE_CLEAR_MS);
      }
      if (data.type === 'a2a-result') {
        addActivity(`A2A → ${data.agent}`, `${data.result?.status}: ${data.result?.effect || data.result?.reason || ''}`);
      }
    };

    ws.onerror = () => addActivity('System', 'WebSocket error');
    ws.onclose = () => addActivity('System', 'Disconnected from Co-Host');

    const soundEvents = new EventSource(`${SOUND_BOARD_URL}/events`);
    soundEvents.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'sound') {
        addActivity('Sound Board', `🔊 ${data.name}`);
        // Play a fallback beep since no audio files exist
        try {
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(data.name === 'airhorn' ? 880 : 440, audioCtx.currentTime);
          gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.5);
        } catch (err) {
          console.error('Audio fallback failed', err);
        }
      }
    };

    const visualEvents = new EventSource(`${HYPE_PRODUCER_URL}/events`);
    visualEvents.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'visual') {
        triggerVisual(data.effect);
        addActivity('Hype Producer', `✨ ${data.effect.name}`);
      }
    };

    return () => {
      ws.close();
      soundEvents.close();
      visualEvents.close();
      stopFrameCapture();
    };
  }, [addActivity, playPcmAudio, stopFrameCapture]);

  // --- Handle video upload ---
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      stopFrameCapture();
      const url = URL.createObjectURL(file);
      setTestVideoUrl(url);
      addActivity('System', `Loaded: ${file.name}`);
    }
  };

  // --- When video starts playing, begin autonomous analysis ---
  const handleVideoPlay = () => {
    startFrameCapture();
  };

  const handleVideoPause = () => {
    stopFrameCapture();
  };

  const handleVideoEnded = () => {
    stopFrameCapture();
    addActivity('System', 'Video ended');
  };

  const triggerVisual = (effect: any) => {
    if (effect.type === 'confetti') {
      confetti({ particleCount: 200, spread: 100, origin: { y: 0.6 } });
    } else if (effect.type === 'screen_shake') {
      const el = document.getElementById('stream-container');
      if (el) {
        el.classList.add('animate-shake');
        setTimeout(() => el.classList.remove('animate-shake'), 800);
      }
    } else if (effect.type === 'graphic_overlay_l') {
      showOverlayGraphic('L');
    } else if (effect.type === 'graphic_overlay_w') {
      showOverlayGraphic('W');
    }
  };

  const showOverlayGraphic = (letter: string) => {
    const el = document.getElementById('overlay-graphic');
    if (el) {
      el.textContent = letter;
      el.classList.remove('hidden');
      el.classList.add('animate-pop');
      setTimeout(() => {
        el.classList.add('hidden');
        el.classList.remove('animate-pop');
      }, 3000);
    }
  };

  return (
    <div className="h-screen bg-zinc-950 text-white font-sans flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Zap size={16} className="text-white fill-current" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">StreamPal</h1>
          {isAnalyzing && (
            <span className="ml-3 flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              AI Watching
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input type="file" ref={fileInputRef} onChange={handleVideoUpload} accept="video/*" className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-indigo-600 hover:bg-indigo-700 transition-all text-sm"
          >
            <Upload size={16} />
            Load Video
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex gap-4 p-4 min-h-0">
        {/* Stream View */}
        <div className="flex-1 flex flex-col min-w-0">
          <div id="stream-container" className="flex-1 bg-black rounded-2xl overflow-hidden border border-zinc-800 relative">
            {testVideoUrl ? (
              <video
                ref={videoRef}
                src={testVideoUrl}
                autoPlay
                controls
                onPlay={handleVideoPlay}
                onPause={handleVideoPause}
                onEnded={handleVideoEnded}
                className="absolute inset-0 w-full h-full object-contain bg-black"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-600">
                <Monitor size={48} className="mb-3 opacity-20" />
                <p className="text-sm">Upload a video to start</p>
                <p className="text-xs text-zinc-700 mt-1">The AI co-host will watch and react autonomously</p>
              </div>
            )}

            {/* Overlay Graphic (L / W) */}
            <div id="overlay-graphic" className="hidden absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
            </div>

            {/* Subtitles */}
            {subtitles && (
              <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur-md px-5 py-2.5 rounded-xl border border-indigo-500/30 max-w-xl text-center z-20 pointer-events-none">
                <p className="text-base font-medium text-indigo-200">{subtitles}</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar — Agent Activity */}
        <div className="w-80 shrink-0 flex flex-col">
          <div className="flex-1 bg-zinc-900 rounded-2xl border border-zinc-800 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
              <MessageSquare size={16} className="text-indigo-400" />
              <h2 className="font-semibold text-sm">Agent Activity</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {activity.length === 0 ? (
                <p className="text-zinc-600 text-xs text-center mt-8">Upload a video to begin...</p>
              ) : (
                activity.map((act, i) => (
                  <div key={i} className="bg-zinc-800/50 p-2.5 rounded-lg border border-zinc-700/30">
                    <div className="flex justify-between items-start mb-0.5">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${
                        act.agent === 'Co-Host' ? 'text-indigo-400' :
                        act.agent.includes('Sound') ? 'text-amber-400' :
                        act.agent.includes('Hype') ? 'text-emerald-400' :
                        act.agent.includes('A2A') ? 'text-cyan-400' :
                        'text-zinc-500'
                      }`}>{act.agent}</span>
                      <span className="text-[9px] text-zinc-600">{act.time}</span>
                    </div>
                    <p className="text-xs text-zinc-300 leading-relaxed">{act.action}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translate(0, 0); }
          10% { transform: translate(-4px, -3px); }
          20% { transform: translate(4px, 3px); }
          30% { transform: translate(-4px, 3px); }
          40% { transform: translate(4px, -3px); }
          50% { transform: translate(-3px, -2px); }
          60% { transform: translate(3px, 2px); }
          70% { transform: translate(-2px, 2px); }
          80% { transform: translate(2px, -2px); }
        }
        .animate-shake { animation: shake 0.6s cubic-bezier(.36,.07,.19,.97) both; }
        @keyframes pop {
          0% { transform: scale(0); opacity: 0; }
          50% { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .animate-pop { animation: pop 0.5s ease-out both; font-size: 12rem; font-weight: 900; color: white; text-shadow: 0 0 60px rgba(99,102,241,0.8); }
      `}</style>
    </div>
  );
};

export default App;
