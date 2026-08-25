import React from 'react';
import { Mic, Sparkles, Volume2 } from 'lucide-react';

/**
 * @component VoiceOrb
 * @description High-end animated voice orb responsive to conversation states:
 * - 'idle'      : Gentle breathing, subtle cyan/indigo neon
 * - 'listening' : Responsive pulse, emerald/cyan neon rings
 * - 'thinking'  : Violet/indigo energy vortex
 * - 'speaking'  : Synchronized golden/cyan concentric light waves
 */
export default function VoiceOrb({ state = 'idle', audioLevel = 0, onClick }) {
  const getGlowColor = () => {
    switch (state) {
      case 'listening':
        return 'from-emerald-500/40 via-cyan-500/40 to-teal-500/30 shadow-emerald-500/30';
      case 'thinking':
        return 'from-purple-600/40 via-indigo-600/40 to-cyan-500/30 shadow-purple-500/30';
      case 'speaking':
        return 'from-cyan-400/50 via-teal-500/40 to-indigo-600/40 shadow-cyan-400/40';
      default:
        return 'from-cyan-600/20 via-indigo-700/20 to-purple-800/10 shadow-cyan-500/10';
    }
  };

  const getCoreColor = () => {
    switch (state) {
      case 'listening':
        return 'bg-gradient-to-tr from-emerald-400 to-cyan-400';
      case 'thinking':
        return 'bg-gradient-to-tr from-purple-500 to-indigo-400 animate-spin';
      case 'speaking':
        return 'bg-gradient-to-tr from-cyan-300 via-teal-300 to-indigo-400 animate-pulse';
      default:
        return 'bg-gradient-to-tr from-cyan-600 to-indigo-600';
    }
  };

  const scaleMultiplier = state === 'listening' || state === 'speaking'
    ? 1 + Math.min(audioLevel * 0.4, 0.3)
    : 1;

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      className="relative flex items-center justify-center cursor-pointer select-none group w-52 h-52 sm:w-64 sm:h-64"
    >
      {/* Outer Ripple Wave 1 */}
      {(state === 'listening' || state === 'speaking') && (
        <div
          className="absolute inset-0 rounded-full border border-cyan-400/30 animate-ping opacity-30"
          style={{ animationDuration: state === 'speaking' ? '1.8s' : '2.4s' }}
        />
      )}

      {/* Outer Ripple Wave 2 */}
      {(state === 'listening' || state === 'speaking') && (
        <div
          className="absolute -inset-4 rounded-full border border-teal-400/20 animate-pulse opacity-40"
          style={{ animationDuration: '2s' }}
        />
      )}

      {/* Atmospheric Glow */}
      <div
        className={`absolute inset-2 rounded-full bg-gradient-to-tr ${getGlowColor()} blur-2xl transition-all duration-700`}
        style={{ transform: `scale(${scaleMultiplier * 1.15})` }}
      />

      {/* Main Glass Shell */}
      <div
        className="relative w-36 h-36 sm:w-44 sm:h-44 rounded-full p-1 bg-gradient-to-b from-white/20 via-white/5 to-transparent backdrop-blur-xl border border-white/20 flex items-center justify-center shadow-2xl transition-transform duration-300"
        style={{ transform: `scale(${scaleMultiplier})` }}
      >
        {/* Animated Core */}
        <div
          className={`w-26 h-26 sm:w-32 sm:h-32 rounded-full ${getCoreColor()} shadow-inner opacity-90 blur-[1px] transition-all duration-500 flex items-center justify-center`}
        >
          {/* Inner Light Flare */}
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-white/40 blur-md" />
        </div>

        {/* State Label Icon */}
        <div className="absolute inset-0 flex items-center justify-center text-white/90 font-medium text-xs tracking-wider uppercase drop-shadow">
          {state === 'listening' && (
            <span className="animate-bounce flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full border border-emerald-400/30 text-emerald-300">
              <Mic size={13} className="text-emerald-400" /> Écoute…
            </span>
          )}
          {state === 'thinking' && (
            <span className="animate-pulse flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full border border-purple-400/30 text-purple-300">
              <Sparkles size={13} className="text-purple-400" /> Réflexion…
            </span>
          )}
          {state === 'speaking' && (
            <span className="animate-pulse flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full border border-cyan-400/30 text-cyan-300">
              <Volume2 size={13} className="text-cyan-400" /> Zephir parle…
            </span>
          )}
          {state === 'idle' && (
            <span className="opacity-70 group-hover:opacity-100 transition bg-black/30 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 text-slate-300">
              Appuyer
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
