export interface ChordSlot {
  id: string;
  chord: string;
}

export interface Progression {
  id: string;
  title: string;
  chords: ChordSlot[];
  bpm: number;
  timeSig: number;
  createdAt: string;
}
