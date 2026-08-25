import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Cpu, Sparkles } from 'lucide-react';
import { useSettings } from '../context/SettingsContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { postConversationModel } from '../api/client.js';

export default function ActiveModelLabel({
  className = '',
  conversation = '',
  conversationModel = null,
  onModelChange = null,
}) {
  const {
    modelFamily = 'opencode/nemotron-3-ultra-free',
    modelLabel = '',
    modelFamilies = [],
    setModelSelection,
  } = useSettings();
  const { pushToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

    const families = modelFamilies.length
    ? modelFamilies
    : [
      { id: 'opencode/nemotron-3.5-lightning-free', label: 'Nemotron 3.5 Lightning', speed: '~100 t/s · Gratuit' },
      { id: 'opencode/big-pickle', label: 'Big Pickle', speed: '~75 t/s · Gratuit' },
      { id: 'opencode/hy3-free', label: 'HY3', speed: '~80 t/s · Gratuit' },
      { id: 'opencode/mimo-v2.5-free', label: 'Mimo V2.5', speed: '~75 t/s · Gratuit' },
      { id: 'opencode/nemotron-3-ultra-free', label: 'Nemotron 3 Ultra', speed: '~80 t/s · Gratuit' },
      { id: 'opencode/muse-spark-1.2-contributor-free', label: 'Muse Spark 1.2', speed: '~60 t/s · Gratuit' },
      { id: 'opencode/x-preview-f-free', label: 'X-Preview', speed: '~90 t/s · Gratuit' },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3 (Direct)', speed: '~70 t/s · Précis' },
      { id: 'deepseek/deepseek-reasoner', label: 'DeepSeek R1 Raisonnement', speed: '~45 t/s · Raisonnement' },
    ];

  const activeModelId = conversation ? (conversationModel || modelFamily) : modelFamily;

  const text = useMemo(() => {
    const hit = families.find((f) => f.id === activeModelId);
    if (hit?.label) return hit.label;
    if (activeModelId && activeModelId !== modelFamily) {
      const parts = activeModelId.split('/');
      return parts[parts.length - 1];
    }
    return String(modelLabel || 'Nemotron 3 Ultra (Gratuit)').trim() || 'Nemotron 3 Ultra (Gratuit)';
  }, [activeModelId, families, modelLabel, modelFamily]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [isOpen]);

  const handleSelectModel = async (familyId) => {
    setIsOpen(false);
    if (familyId === activeModelId) return;
    const selectedFamily = families.find((f) => f.id === familyId);
    const label = selectedFamily?.label || familyId;
    const isFast = familyId.includes('flash') || familyId.includes('lightning');

    if (conversation) {
      try {
        onModelChange?.(familyId, label);
        const res = await postConversationModel(conversation, {
          model: familyId,
          modelLabel: label,
          modelEffort: 'full',
          modelFast: isFast,
        });
        if (res.ok) {
          pushToast(`Modèle actif pour cette discussion : ${label}`, { type: 'success' });
        } else {
          pushToast(res.error || 'Erreur changement de modèle', { type: 'error' });
        }
      } catch (err) {
        pushToast(err.message || 'Erreur changement de modèle', { type: 'error' });
      }
      return;
    }

    try {
      const res = await setModelSelection({
        family: familyId,
        effort: 'full',
        fast: isFast,
      });
      if (res.ok) {
        pushToast(`Modèle par défaut : ${res.modelLabel || familyId}`, { type: 'success' });
      } else {
        pushToast(res.error || 'Erreur changement de modèle', { type: 'error' });
      }
    } catch (err) {
      pushToast(err.message || 'Erreur changement de modèle', { type: 'error' });
    }
  };

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`group inline-flex items-center gap-1 py-0.5 px-1.5 rounded-md hover:bg-white/10 text-slate-300 hover:text-white transition cursor-pointer text-[11px] sm:text-xs font-medium leading-tight max-w-full ${className}`}
        title="Changer de modèle IA"
      >
        <span className="truncate max-w-[22vw] xs:max-w-[30vw] sm:max-w-[14rem]">{text}</span>
        <ChevronDown size={12} className={`text-slate-400 group-hover:text-white transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-64 rounded-xl border border-white/15 bg-slate-900/95 backdrop-blur-md shadow-2xl p-1.5 z-[100] space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-white/5 mb-1">
            <Cpu size={12} className="text-brand-400" />
            Sélectionner un Modèle OpenCode
          </div>
          {families.map((f) => {
            const isSelected = f.id === activeModelId;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => handleSelectModel(f.id)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition cursor-pointer text-xs ${
                  isSelected
                    ? 'bg-brand-600/25 text-white border border-brand-500/40 font-medium'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white border border-transparent'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate">{f.label}</p>
                  {f.speed && <p className="text-[10px] text-slate-500">{f.speed}</p>}
                </div>
                {isSelected && <Check size={14} className="text-brand-400 shrink-0 ml-1.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
