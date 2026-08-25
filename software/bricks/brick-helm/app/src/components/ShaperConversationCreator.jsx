import { useState, useRef, useEffect } from 'react';
import { Plus, Sparkles, X, Bot, Cpu, ArrowRight } from 'lucide-react';
import { useLocale } from '../context/LocaleContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { useI18n } from '../i18n/index.jsx';

const SHAPER_TEMPLATES = [
  { id: 'ops', label: '🚀 Ops & Monitoring', defaultName: 'Supervision UNIV9' },
  { id: 'mail', label: '✉️ Triage Mails', defaultName: 'Triage Boîte Contact' },
  { id: 'dev', label: '💻 Code & Déploiement', defaultName: 'Développement Socle' },
  { id: 'chat', label: '💬 Session Libre', defaultName: 'Nouvelle Session' },
];

export default function ShaperConversationCreator({
  defaultNode = 'opencode',
  onCreate,
}) {
  const { t } = useLocale();
  const { currentLocale } = useI18n();
  const { defaultModels = {} } = useSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState('opencode');
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleCreate = (nameToUse) => {
    const raw = String(nameToUse || sessionName || '').trim();
    const finalName = raw || `Session-${new Date().toLocaleDateString(currentLocale || 'fr-FR', { day: '2-digit', month: '2-digit' })}-${Math.floor(Math.random() * 900 + 100)}`;
    
    const conversationPath = finalName.replace(/[/\\?%*:|"<>]/g, '-');
    
    if (onCreate) {
      onCreate({
        path: conversationPath,
        name: finalName,
        plugin: selectedPlugin,
        model: defaultModels[selectedPlugin] || undefined,
        workspace: '/data/opencode-ws',
      });
    }

    setSessionName('');
    setIsOpen(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  if (!isOpen) {
    return (
      <div className="p-2 shrink-0 border-b border-white/5">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-brand-600/20 hover:bg-brand-600/30 border border-brand-500/30 text-brand-300 hover:text-white transition-all font-medium text-xs shadow-sm hover:shadow group cursor-pointer"
        >
          <Plus size={13} className="transition-transform group-hover:rotate-90 text-brand-400" />
          <span className="truncate">{currentLocale === 'es' ? 'Nueva Sesión' : currentLocale === 'en' ? 'New Session' : 'Nouvelle Session'}</span>
          <Sparkles size={12} className="text-amber-400 opacity-80 shrink-0" />
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 shrink-0 border-b border-white/10 bg-slate-900/60 backdrop-blur-md space-y-2.5 rounded-b-xl">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-brand-300 flex items-center gap-1.5 uppercase tracking-wider">
          <Bot size={13} />
          {currentLocale === 'es' ? 'Crear Sesión' : currentLocale === 'en' ? 'Create Session' : 'Créer une Session'}
        </span>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
          title="Fermer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Conversation name input */}
      <div className="space-y-1">
        <input
          ref={inputRef}
          type="text"
          value={sessionName}
          onChange={(e) => setSessionName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={currentLocale === 'es' ? 'Ej: Supervisión UNIV9...' : currentLocale === 'en' ? 'Ex: Supervision UNIV9...' : 'Ex: Supervision UNIV9...'}
          className="w-full bg-slate-800/90 border border-slate-700 focus:border-brand-500 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 outline-none transition"
        />
      </div>

      {/* Quick template suggestions */}
      <div className="space-y-1">
        <p className="text-[10px] text-slate-400">Templates rapides :</p>
        <div className="grid grid-cols-2 gap-1">
          {SHAPER_TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.id}
              type="button"
              onClick={() => handleCreate(tmpl.defaultName)}
              className="text-left px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-brand-500/40 text-[10px] text-slate-300 truncate transition"
            >
              {tmpl.label}
            </button>
          ))}
        </div>
      </div>

      {/* Engine / Agent selector */}
      <div className="flex items-center justify-between pt-1 border-t border-white/5">
        <div className="flex items-center gap-1 text-[10px] text-slate-400">
          <Cpu size={11} className="text-brand-400" />
          <span>Moteur :</span>
        </div>
        <select
          value={selectedPlugin}
          onChange={(e) => setSelectedPlugin(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-200 px-1.5 py-0.5 outline-none"
        >
          <option value="opencode">OpenCode Souverain</option>
          <option value="maestro">Maestro Orchestrateur</option>
        </select>
      </div>

      {/* Action buttons */}
      <div className="flex gap-1.5 pt-1">
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="flex-1 py-1.5 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-slate-400 hover:text-white transition text-center"
        >
          {currentLocale === 'es' ? 'Cancelar' : currentLocale === 'en' ? 'Cancel' : 'Annuler'}
        </button>
        <button
          type="button"
          onClick={() => handleCreate()}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-xs text-white font-medium transition shadow"
        >
          <span>{currentLocale === 'es' ? 'Crear' : currentLocale === 'en' ? 'Create' : 'Créer'}</span>
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}
