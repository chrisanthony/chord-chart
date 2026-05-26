// ── Local library (localStorage) ─────────────────────────────────────────────

const STORAGE_KEY = 'chord-chart-library';

export interface LibraryEntry {
  serverId:   string;   // used to build /p/${serverId}
  title:      string;
  chordNames: string[]; // slot.chord values, for preview display
  bpm:        number;
  timeSig:    number;
  savedAt:    number;   // Date.now() — used as stable identity key
}

function read(): LibraryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LibraryEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: LibraryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* ignore quota errors */ }
}

/** Return all saved progressions, newest first. */
export function getLibrary(): LibraryEntry[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Add or update a library entry.
 * Match is by `savedAt` (stable identity across re-saves).
 * If no match is found, the entry is prepended.
 */
export function upsertEntry(entry: LibraryEntry): void {
  const entries = read();
  const idx = entries.findIndex(e => e.savedAt === entry.savedAt);
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.unshift(entry);
  }
  write(entries);
}

/** Update just the title of an entry identified by savedAt. */
export function renameEntry(savedAt: number, title: string): void {
  const entries = read();
  const entry = entries.find(e => e.savedAt === savedAt);
  if (entry) { entry.title = title; write(entries); }
}

/** Remove an entry by savedAt. */
export function deleteEntry(savedAt: number): void {
  write(read().filter(e => e.savedAt !== savedAt));
}
