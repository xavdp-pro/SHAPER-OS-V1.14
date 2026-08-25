function parseToolInput(input) {
  if (!input) return {};
  if (typeof input === 'object') return input;
  try {
    return JSON.parse(input);
  } catch {
    return { raw: String(input) };
  }
}

function toolCommand(args) {
  return args.command || args.cmd || args.script || '';
}

function blockToLines(block) {
  const lines = [];
  if (block.type === 'thinking' && block.text) {
    lines.push('### Réflexion', '', block.text, '');
  }
  if (block.type === 'assistant' && block.text) {
    lines.push('### Assistant', '', block.text, '');
  }
  if (block.type === 'tool') {
    const tool = String(block.tool || 'tool').toLowerCase();
    const args = parseToolInput(block.input);
    const command = block.command || toolCommand(args);
    const cwd = block.cwd || args.workingDirectory || args.cwd || '';
    lines.push(`### Outil: ${tool}`);
    if (cwd) lines.push(`_cwd: ${cwd}_`);
    if (command) {
      lines.push('', '```bash', command, '```');
    } else if (block.input && block.input !== '{}') {
      lines.push('', '```json', block.input, '```');
    }
    if (block.result) {
      lines.push('', '```', block.result, '```');
    }
    lines.push('');
  }
  if (block.type === 'log' && block.text) {
    lines.push('### Log', '', '```', block.text, '```', '');
  }
  if (block.type === 'system' && block.text) {
    lines.push(`> ${block.text}`, '');
  }
  return lines;
}

function itemToMarkdown(item, index) {
  const lines = [];
  if (item.type === 'human') {
    lines.push(`## Message utilisateur ${index + 1}`, '');
    if (item.text) lines.push(item.text);
    if (item.images?.length) {
      lines.push('', `_${item.images.length} image(s) jointe(s)_`);
    }
    lines.push('');
    return lines;
  }
  if (item.type === 'voice_ack') {
    lines.push(`## Accusé réception Groq ${index + 1}`, '', item.text || '', '');
    return lines;
  }
  if (item.type === 'system') {
    lines.push(`> ${item.text}`, '');
    return lines;
  }
  if (item.type === 'run') {
    const status = item.status === 'aborted' ? ' (arrêté)' : '';
    lines.push(`## Tour agent${status}`, '');
    for (const block of item.blocks || []) {
      lines.push(...blockToLines(block));
    }
    return lines;
  }
  return lines;
}

function itemToPlainText(item, index) {
  const lines = [];
  if (item.type === 'human') {
    lines.push(`--- Utilisateur ${index + 1} ---`, item.text || '', '');
    return lines;
  }
  if (item.type === 'voice_ack') {
    lines.push('--- Accusé réception Groq ---', item.text || '', '');
    return lines;
  }
  if (item.type === 'system') {
    lines.push(`[system] ${item.text}`, '');
    return lines;
  }
  if (item.type === 'run') {
    lines.push('--- Agent ---');
    for (const block of item.blocks || []) {
      if (block.type === 'thinking' && block.text) {
        lines.push('[réflexion]', block.text, '');
      }
      if (block.type === 'assistant' && block.text) {
        lines.push('[assistant]', block.text, '');
      }
      if (block.type === 'tool') {
        const args = parseToolInput(block.input);
        const command = block.command || toolCommand(args);
        lines.push(`[outil ${block.tool}]`, command || block.input || '', block.result || '', '');
      }
      if (block.type === 'log' && block.text) {
        lines.push('[log]', block.text, '');
      }
      if (block.type === 'system' && block.text) {
        lines.push(`[system] ${block.text}`, '');
      }
    }
    lines.push('');
    return lines;
  }
  return lines;
}

/** Exporte une timeline en markdown ou texte brut. */
export function exportTimeline(items, { format = 'markdown', title = '' } = {}) {
  const list = Array.isArray(items) ? items : [];
  const header = format === 'markdown'
    ? [`# Conversation${title ? `: ${title}` : ''}`, '', `_${list.length} entrée(s)_`, '']
    : [`Conversation${title ? `: ${title}` : ''}`, `(${list.length} entrée(s))`, ''];

  const body = list.flatMap((item, i) => (
    format === 'markdown' ? itemToMarkdown(item, i) : itemToPlainText(item, i)
  ));

  const text = [...header, ...body].join('\n').trim();
  return {
    format,
    text,
    markdown: format === 'markdown' ? text : [...header, ...list.flatMap((item, i) => itemToMarkdown(item, i))].join('\n').trim(),
    item_count: list.length,
  };
}
