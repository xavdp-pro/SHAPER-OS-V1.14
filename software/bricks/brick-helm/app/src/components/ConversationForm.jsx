import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import PickerMenu from './PickerMenu.jsx';
import { buildConversationPath } from '../lib/paths.js';
import { useLocale } from '../context/LocaleContext.jsx';

function destKey(node, user) {
  return `${node}::${user}`;
}

function parseDestKey(key) {
  const [node, user] = String(key || '').split('::');
  return { node: node || '', user: user || '' };
}

export default function ConversationForm({
  nodes = [],
  defaultNode = '',
  defaultUser = '',
  onCreate,
}) {
  const { t } = useLocale();
  const nodeList = useMemo(() => (
    nodes.length
      ? nodes
      : [{ name: defaultNode || 'local', user: defaultUser || 'zaza' }]
  ), [nodes, defaultNode, defaultUser]);

  const destOptions = useMemo(() => {
    const seen = new Set();
    return nodeList
      .filter((n) => n.name && n.user)
      .filter((n) => {
        const k = destKey(n.name, n.user);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((n) => ({
        value: destKey(n.name, n.user),
        label: n.name,
        hint: n.user,
      }));
  }, [nodeList]);

  const initialDest = destOptions[0]?.value
    || destKey(defaultNode || 'local', defaultUser || 'zaza');

  const [dest, setDest] = useState(initialDest);
  const [name, setName] = useState('');
  const { node, user } = parseDestKey(dest);
  const preview = buildConversationPath(node, user, name);

  const submit = () => {
    const path = buildConversationPath(node, user, name);
    if (!path) return;
    onCreate(path);
    setName('');
  };

  return (
    <div className="p-2 shrink-0 space-y-2 border-b border-white/10">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1">
        {t('nav.newConv')}
      </p>

      <PickerMenu
        label={t('nav.destLabel')}
        value={dest}
        options={destOptions}
        onChange={setDest}
        placeholder={t('nav.destPlaceholder')}
      />

      <div className="flex gap-1.5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={t('nav.convNamePlaceholder')}
          className="input-field text-sm py-2.5 flex-1 min-w-0 font-mono"
        />
        <button
          type="button"
          disabled={!preview}
          onClick={submit}
          className="btn-secondary px-3 py-2.5 shrink-0"
          title={t('nav.createConvTitle')}
        >
          <Plus size={16} />
        </button>
      </div>

      {preview && (
        <p className="text-[10px] text-slate-600 font-mono px-1 truncate" title={preview}>
          → {preview}
        </p>
      )}
    </div>
  );
}
