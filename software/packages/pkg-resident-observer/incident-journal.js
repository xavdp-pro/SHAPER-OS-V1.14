import fs from 'node:fs';
import path from 'node:path';

function parseLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) return [];
  return text.trimEnd().split('\n').map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`incident journal is unreadable at line ${index + 1}: ${error.message}`);
    }
  });
}
export class IncidentJournal {
  constructor({ filePath }) {
    if (!filePath) throw new Error('incident journal filePath is required');
    this.filePath = path.resolve(filePath);
  }

  readAll() {
    return parseLines(this.filePath);
  }

  current() {
    const incidents = new Map();
    for (const event of this.readAll()) incidents.set(event.incidentId, event);
    return incidents;
  }

  append(event) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    return event;
  }
}
