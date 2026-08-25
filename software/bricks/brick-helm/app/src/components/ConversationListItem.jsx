import { useState, useRef, useEffect } from 'react';
import {
  RotateCcw,
  Trash2,
  MessageSquare,
  Pencil,
  Check,
  X,
  Archive,
  ArchiveRestore,
  Folder,
  MoreVertical,
} from 'lucide-react';
import { convNameFromPath, parseConversationPath, displayNodeLabel } from '../lib/paths.js';
import { sessionNameFromPath } from '../lib/workspaceTemplates.js';

export function sessionTriple(pathOrConversation) {
  const path = typeof pathOrConversation === 'string'
    ? pathOrConversation
    : (pathOrConversation?.path || pathOrConversation?.id || '');
  const parsed = parseConversationPath(path);
  const machine = parsed.node
    || (typeof pathOrConversation === 'object' ? pathOrConversation?.node : '')
    || 'opencode';
  const user = parsed.user
    || (typeof pathOrConversation === 'object' ? pathOrConversation?.user : '')
    || 'shaper';
  const project = parsed.name
    || (typeof pathOrConversation === 'object' ? pathOrConversation?.name : '')
    || convNameFromPath(path)
    || 'Session';
  const cwd = (typeof pathOrConversation === 'object'
    ? String(pathOrConversation?.cwd || pathOrConversation?.workspace || '').trim()
    : '') || '';
  const label = (cwd ? sessionNameFromPath(cwd) : '') || project;
  return { machine, machineLabel: displayNodeLabel(machine), user, project, cwd, label, path };
}

export default function ConversationListItem({
  conversation,
  active,
  streaming,
  reloading = false,
  folders = [],
  onSelect,
  onReload,
  onDelete,
  onRename,
  onArchive,
  onMoveFolder,
}) {
  const path = conversation.path || conversation.id;
  const { label, machineLabel } = sessionTriple(conversation);
  const isArchived = Boolean(conversation.archived_at);
  const currentFolder = conversation.folder || 'Général';

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(label);
  const [showMenu, setShowMenu] = useState(false);
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const inputRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    setEditValue(label);
  }, [label]);

  useEffect(() => {
    if (isEditing) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isEditing]);

  useEffect(() => {
    if (!showMenu) return undefined;
    const handleOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
        setShowFolderMenu(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [showMenu]);

  const handleSaveRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== label && typeof onRename === 'function') {
      onRename(path, trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveRename();
    } else if (e.key === 'Escape') {
      setEditValue(label);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1.5 rounded-xl border border-brand-500/60 bg-slate-900/95 px-2.5 py-2 shadow-lg ring-2 ring-brand-500/20">
        <MessageSquare size={14} className="text-brand-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 bg-slate-800/90 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-brand-500"
        />
        <button
          type="button"
          onClick={handleSaveRename}
          className="p-1 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/20 rounded-lg transition cursor-pointer"
          title="Valider"
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          onClick={() => {
            setEditValue(label);
            setIsEditing(false);
          }}
          className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition cursor-pointer"
          title="Annuler"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative group/conv select-none" ref={menuRef}>
      <div
        className={`relative flex items-center justify-between rounded-lg border transition-all duration-150 px-2 py-1.5 ${
          active
            ? 'bg-gradient-to-r from-brand-600/20 to-brand-500/10 border-brand-500/40 text-white shadow-sm border-l-[3px] border-l-brand-400'
            : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/[0.06] hover:border-white/15 hover:text-slate-200'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelect(path)}
          className="flex-1 min-w-0 text-left cursor-pointer flex items-center gap-2 pr-1"
        >
          <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md bg-black/20">
            {streaming ? (
              <span className="block w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" />
            ) : (
              <MessageSquare
                size={12}
                className={active ? 'text-brand-400' : 'text-slate-500 group-hover/conv:text-slate-300'}
              />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <span
              className={`block text-[11px] font-medium leading-tight truncate ${
                active ? 'text-white font-semibold' : 'text-slate-300 group-hover/conv:text-white'
              }`}
              title={label}
            >
              {label}
            </span>
            <div className="flex items-center gap-1 mt-0.5 text-[9px] text-slate-500 font-mono leading-none">
              <span className="truncate">{machineLabel || 'OpenCode'}</span>
              {currentFolder && currentFolder !== 'Général' && (
                <>
                  <span>·</span>
                  <span className="text-cyan-400/80 truncate inline-flex items-center gap-0.5">
                    <Folder size={9} className="text-amber-400 shrink-0" />
                    <span>{currentFolder}</span>
                  </span>
                </>
              )}
            </div>
          </div>
        </button>

        <div className="shrink-0 flex items-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu((v) => !v);
              setShowFolderMenu(false);
            }}
            className={`p-0.5 rounded-md transition cursor-pointer ${
              showMenu || active
                ? 'opacity-100 text-slate-300 hover:text-white hover:bg-white/10'
                : 'opacity-0 group-hover/conv:opacity-100 text-slate-500 hover:text-slate-200 hover:bg-white/10'
            }`}
            title="Options"
            aria-label="Options"
          >
            <MoreVertical size={13} />
          </button>
        </div>
      </div>

      {showMenu && (
        <div className="absolute right-1 top-full mt-1 z-50 w-48 rounded-xl border border-white/15 bg-[#0e1626]/98 backdrop-blur-xl shadow-2xl p-1 text-xs text-slate-200 animate-in fade-in zoom-in-95 duration-100">
          {typeof onRename === 'function' && (
            <button
              type="button"
              onClick={() => {
                setShowMenu(false);
                setIsEditing(true);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 hover:text-white transition cursor-pointer text-left"
            >
              <Pencil size={13} className="text-brand-400" />
              <span>Renommer</span>
            </button>
          )}

          {typeof onMoveFolder === 'function' && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowFolderMenu((v) => !v)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-white/10 hover:text-white transition cursor-pointer text-left"
              >
                <span className="flex items-center gap-2">
                  <Folder size={13} className="text-amber-400" />
                  <span>Dossier</span>
                </span>
                <span className="text-[10px] text-slate-500 font-mono">▸</span>
              </button>

              {showFolderMenu && (
                <div className="pl-4 pr-1 py-1 space-y-0.5 border-l border-white/10 ml-3 my-0.5">
                  {folders.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        onMoveFolder(path, f);
                        setShowMenu(false);
                        setShowFolderMenu(false);
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1 rounded text-[11px] transition cursor-pointer ${
                        currentFolder === f
                          ? 'bg-amber-500/20 text-amber-200 font-medium'
                          : 'text-slate-400 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <span className="truncate inline-flex items-center gap-1.5">
                        <Folder size={11} className="text-amber-400 shrink-0" />
                        <span>{f}</span>
                      </span>
                      {currentFolder === f && <Check size={11} className="text-amber-300" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {typeof onReload === 'function' && (
            <button
              type="button"
              disabled={reloading}
              onClick={() => {
                setShowMenu(false);
                onReload(path);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 hover:text-white transition cursor-pointer text-left disabled:opacity-40"
            >
              <RotateCcw size={13} className={`text-sky-400 ${reloading ? 'animate-spin' : ''}`} />
              <span>Recharger</span>
            </button>
          )}

          {typeof onArchive === 'function' && (
            <button
              type="button"
              onClick={() => {
                setShowMenu(false);
                onArchive(path, !isArchived);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 hover:text-white transition cursor-pointer text-left"
            >
              {isArchived ? (
                <>
                  <ArchiveRestore size={13} className="text-indigo-400" />
                  <span>Désarchiver</span>
                </>
              ) : (
                <>
                  <Archive size={13} className="text-indigo-400" />
                  <span>Archiver</span>
                </>
              )}
            </button>
          )}

          <div className="h-px bg-white/10 my-1" />

          {typeof onDelete === 'function' && (
            <button
              type="button"
              onClick={() => {
                setShowMenu(false);
                onDelete(path);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-red-400 hover:bg-red-500/15 hover:text-red-300 transition cursor-pointer text-left"
            >
              <Trash2 size={13} />
              <span>Supprimer</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
