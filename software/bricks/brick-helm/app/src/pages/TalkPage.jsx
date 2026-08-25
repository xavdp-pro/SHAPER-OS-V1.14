import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mic, MicOff, Volume2, VolumeX, MessageSquare, Sparkles, FolderArchive, ArrowLeft, RefreshCw } from 'lucide-react';
import VoiceOrb from '../components/VoiceOrb.jsx';
import { injectMessage, getConversations, getTimeline, voiceChat } from '../api/client.js';
import { createRealtimeSttSession, acquireMicMediaStream } from '../lib/voiceRealtimeStt.js';
import { createVoiceTtsStreamSession } from '../lib/voiceTtsStream.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function TalkPage() {
  const { user } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();

  const [voiceState, setVoiceState] = useState('idle'); // 'idle' | 'listening' | 'thinking' | 'speaking'
  const [liveTranscript, setLiveTranscript] = useState('');
  const [spokenResponse, setSpokenResponse] = useState('Bonjour ! Je suis Zephir. Comment puis-je vous aider aujourd’hui ?');
  const [conversationHistory, setConversationHistory] = useState([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [handsFree, setHandsFree] = useState(true);
  const [activeSession, setActiveSession] = useState('cursor/zaza/Administrateur');

  const sttSessionRef = useRef(null);
  const currentTtsRef = useRef(null);
  const synthRef = useRef(typeof window !== 'undefined' ? window.speechSynthesis : null);

  const stopCurrentTts = () => {
    if (currentTtsRef.current) {
      try { currentTtsRef.current.cancel(); } catch {}
      currentTtsRef.current = null;
    }
    if (synthRef.current) {
      try { synthRef.current.cancel(); } catch {}
    }
  };

  const startDeepgramStt = async () => {
    stopCurrentTts();
    if (sttSessionRef.current) {
      sttSessionRef.current.close();
      sttSessionRef.current = null;
    }

    try {
      const stream = await acquireMicMediaStream();
      const session = createRealtimeSttSession({
        lang: 'fr',
        mediaStream: stream,
        onDraft: (text) => {
          if (text) {
            setLiveTranscript(text);
            setVoiceState('listening');
          }
        },
        onLivePreview: (partial) => {
          if (partial) {
            setLiveTranscript(partial);
            setVoiceState('listening');
          }
        },
        onCommitted: (finalText) => {
          if (finalText && finalText.trim()) {
            handleSendVoicePrompt(finalText.trim());
          }
        },
        onReady: () => {
          setVoiceState('listening');
          setLiveTranscript('Je vous écoute…');
          session.armListening();
        },
        onError: (err) => {
          console.warn('[Deepgram STT] Error:', err);
          pushToast('Erreur microphone / Deepgram STT', { type: 'error' });
          setVoiceState('idle');
        },
      });

      session.start();
      sttSessionRef.current = session;
    } catch (err) {
      console.warn('[TalkPage] Unable to activate microphone:', err);
      pushToast('Microphone non accessible', { type: 'error' });
      setVoiceState('idle');
    }
  };

  const stopDeepgramStt = () => {
    if (sttSessionRef.current) {
      sttSessionRef.current.close();
      sttSessionRef.current = null;
    }
    setVoiceState('idle');
  };

  const toggleMic = () => {
    if (voiceState === 'listening') {
      stopDeepgramStt();
    } else {
      startDeepgramStt();
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const conv = await getConversations();
        if (conv.ok && conv.data?.conversations?.length) {
          const first = conv.data.conversations[0]?.path || conv.data.conversations[0]?.id;
          if (first) setActiveSession(first);
        }
      } catch {}
    })();

    return () => {
      stopDeepgramStt();
      stopCurrentTts();
    };
  }, []);

  const speakText = async (text) => {
    if (isMuted) return;
    stopCurrentTts();
    stopDeepgramStt();
    setVoiceState('speaking');

    const clean = text
      .replace(/[*#_`]/g, '')
      .replace(/https?:\/\/\S+/g, 'lien')
      .slice(0, 300);

    try {
      // Pure Deepgram Aura-2 WebSocket Streaming TTS
      const tts = createVoiceTtsStreamSession({
        lang: 'fr',
        voiceId: 'aura-2-agathe-fr',
        onPlaybackClock: (_sec, hasStarted) => {
          if (hasStarted()) setVoiceState('speaking');
        },
        onError: (err) => {
          console.warn('[Deepgram TTS] Stream error, fallback:', err);
          if (synthRef.current) {
            const utter = new SpeechSynthesisUtterance(clean);
            utter.lang = 'fr-FR';
            utter.onend = () => {
              setVoiceState(handsFree ? 'listening' : 'idle');
              if (handsFree) startDeepgramStt();
            };
            synthRef.current.speak(utter);
          }
        },
      });

      currentTtsRef.current = tts;
      await tts.ready;
      tts.push(clean);
      await tts.end();
      setVoiceState(handsFree ? 'listening' : 'idle');
      if (handsFree) {
        startDeepgramStt();
      }
    } catch (err) {
      console.warn('[Deepgram TTS] catch fallback:', err);
      if (synthRef.current) {
        const utter = new SpeechSynthesisUtterance(clean);
        utter.lang = 'fr-FR';
        utter.onend = () => {
          setVoiceState(handsFree ? 'listening' : 'idle');
          if (handsFree) startDeepgramStt();
        };
        synthRef.current.speak(utter);
      } else {
        setVoiceState('idle');
      }
    }
  };

  const handleSendVoicePrompt = async (prompt) => {
    if (!prompt || !prompt.trim()) return;
    stopDeepgramStt();
    setVoiceState('thinking');
    setLiveTranscript(prompt);
    setSpokenResponse('Réflexion…');

    try {
      // Direct conversational voice exchange in <300ms
      const res = await voiceChat(prompt, 'fr', conversationHistory);
      if (res.ok && res.data?.text) {
        const reply = res.data.text;
        setSpokenResponse(reply);
        setConversationHistory((prev) => [
          ...prev.slice(-4),
          { role: 'user', content: prompt },
          { role: 'assistant', content: reply },
        ]);
        await speakText(reply);

        // Synchronize in background with timeline
        void injectMessage(prompt, [], {
          conversation: activeSession,
          voiceTurn: true,
        }).catch(() => {});
        return;
      }

      const fallbackReply = 'Je vous écoute, que souhaitez-vous savoir ?';
      setSpokenResponse(fallbackReply);
      await speakText(fallbackReply);
    } catch (err) {
      console.warn('[TalkPage] error in voice conversation:', err);
      const fallbackReply = 'Je suis là, que puis-je faire pour vous ?';
      setSpokenResponse(fallbackReply);
      await speakText(fallbackReply);
    }
  };

  return (
    <div className="h-dvh max-h-dvh bg-[#060913] text-slate-100 flex flex-col justify-between selection:bg-cyan-500/30 overflow-hidden font-sans">
      {/* 1. Header — Clean & uncluttered on mobile & desktop */}
      <header className="px-3 py-2.5 sm:px-6 sm:py-3.5 flex items-center justify-between border-b border-white/5 bg-[#090e1a]/80 backdrop-blur-xl z-20">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-white font-bold shadow-lg shadow-cyan-500/20 shrink-0">
            <Sparkles size={15} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5 truncate">
              Zephir Talk 
              <span className="text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/30 flex items-center gap-1 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Direct
              </span>
            </h1>
            <p className="text-[10px] sm:text-[11px] text-slate-400 hidden sm:block truncate">Assistant vocal conversationnel grand public</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <a
            href="/ged"
            target="_blank"
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 transition text-xs flex items-center gap-1.5 border border-white/5"
            title="Ouvrir la Mini-GED"
          >
            <FolderArchive size={14} className="text-amber-400" />
            <span className="hidden sm:inline">Mini-GED</span>
          </a>
          <button
            type="button"
            onClick={() => setIsMuted(!isMuted)}
            className="p-1.5 sm:p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 transition border border-white/5"
            title={isMuted ? 'Activer la voix de synthèse' : 'Couper le son'}
          >
            {isMuted ? <VolumeX size={15} className="text-red-400" /> : <Volume2 size={15} className="text-cyan-400" />}
          </button>
          <Link
            to="/console"
            onClick={() => { stopDeepgramStt(); stopCurrentTts(); }}
            className="px-2.5 py-1.5 sm:px-3.5 sm:py-1.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 transition text-xs font-semibold flex items-center gap-1.5"
          >
            <MessageSquare size={13} />
            <span className="hidden sm:inline">Mode Console</span>
            <span className="sm:hidden">Chat</span>
          </Link>
        </div>
      </header>

      {/* 2. Main Stage (Central Orb & Subtitles) */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-2 sm:p-6 text-center max-w-2xl mx-auto w-full relative z-10">
        {/* Central Voice Orb */}
        <div className="my-2 sm:my-4">
          <VoiceOrb
            state={voiceState}
            audioLevel={audioLevel}
            onClick={toggleMic}
          />
        </div>

        {/* Live Subtitle Bubble */}
        <div className="w-full max-w-lg min-h-[75px] sm:min-h-[85px] rounded-2xl bg-white/[0.03] border border-white/10 p-3.5 sm:p-4 shadow-2xl backdrop-blur-md flex flex-col items-center justify-center transition-all duration-300">
          {voiceState === 'listening' ? (
            <p className="text-xs sm:text-sm font-medium text-cyan-300 italic animate-pulse">
              "{liveTranscript || 'Je vous écoute… Parlez naturellement.'}"
            </p>
          ) : (
            <p className="text-xs sm:text-sm font-normal text-slate-200 leading-relaxed">
              {spokenResponse}
            </p>
          )}
        </div>

        {/* Quick Suggestion Chips (100% SVG Icons, Zero Broken Glyphs) */}
        <div className="mt-4 sm:mt-6 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 max-w-md">
          {[
            'Bonjour Zephir !',
            'Fais-moi le point sur les documents',
            'Génère un bilan comptable',
            'Créer un devis client',
          ].map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handleSendVoicePrompt(prompt)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] sm:text-xs text-slate-300 hover:text-white transition shadow-sm"
            >
              <MessageSquare size={11} className="text-cyan-400 shrink-0" />
              <span>{prompt}</span>
            </button>
          ))}
        </div>
      </main>

      {/* 3. Bottom Minimal Helper */}
      <footer className="px-4 py-2 sm:py-3 text-center text-[10px] sm:text-[11px] text-slate-500 z-20 shrink-0">
        Touchez l’orbe ou parlez librement en mode mains-libres.
      </footer>
    </div>
  );
}
