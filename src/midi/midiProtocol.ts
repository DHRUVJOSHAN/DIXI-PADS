export type MidiPacket = readonly [number, number, number];

export function clampChannel(channel: number): number {
  return Math.max(0, Math.min(15, Math.round(channel)));
}

export function clampNote(note: number): number {
  return Math.max(0, Math.min(127, Math.round(note)));
}

export function clampVelocity(velocity: number): number {
  return Math.max(0, Math.min(127, Math.round(velocity)));
}

export function clampCCValue(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)));
}

export function clampPitchBend14(value: number): number {
  return Math.max(0, Math.min(16383, Math.round(value)));
}

export function buildNoteOn(channel: number, note: number, velocity: number): MidiPacket {
  const ch = clampChannel(channel);
  return [0x90 | ch, clampNote(note), clampVelocity(velocity)];
}

export function buildNoteOff(channel: number, note: number): MidiPacket {
  const ch = clampChannel(channel);
  return [0x80 | ch, clampNote(note), 0x00];
}

export function buildPitchBend(channel: number, value14: number): MidiPacket {
  const ch = clampChannel(channel);
  const clamped = clampPitchBend14(value14);
  const lsb = clamped & 0x7f;
  const msb = (clamped >> 7) & 0x7f;
  return [0xe0 | ch, lsb, msb];
}

export function buildModulation(channel: number, value: number): MidiPacket {
  const ch = clampChannel(channel);
  return [0xb0 | ch, 0x01, clampCCValue(value)];
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function midiNoteToName(note: number): string {
  const clamped = clampNote(note);
  const name = NOTE_NAMES[clamped % 12];
  const octave = Math.floor(clamped / 12) - 1;
  return `${name}${octave}`;
}
