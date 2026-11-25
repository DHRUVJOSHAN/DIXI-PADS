import {
  buildModulation,
  buildNoteOff,
  buildNoteOn,
  buildPitchBend,
  midiNoteToName,
  type MidiPacket,
} from './midiProtocol';

export type LedColorState = 'off' | 'white' | 'blue' | 'pulse';

export interface ControlSurfaceSnapshot {
  channel: number;
  octaveOffset: number;
  semitoneOffset: number;
  baseMidiNote: number;
  baseNoteLabel: string;
  shiftActive: boolean;
  holdMode: boolean;
  chordMode: boolean;
  isCreatingChord: boolean;
  chordIntervals: readonly number[];
  shiftLed: LedColorState;
  holdLed: LedColorState;
  octDownLed: LedColorState;
  octUpLed: LedColorState;
  pitchNormalized: number; // 0..1, 0.5 center
  modNormalized: number;   // 0..1
  activePads: readonly boolean[];  // physical press state per pad (0..11)
  latchedPads: readonly boolean[]; // latched/sustained visual state per pad (0..11)
}

export const DEFAULT_BASE_MIDI_NOTE = 36; // C1 (standard Drum Rack / MPC bank A)
export const MIN_OCTAVE_OFFSET = -3;      // MIDI 0 (C-1)
export const MAX_OCTAVE_OFFSET = 5;       // MIDI 96 (C6)
export const MIN_SEMITONE_OFFSET = -12;
export const MAX_SEMITONE_OFFSET = 12;
export const SHIFT_TAP_WINDOW_MS = 400;
export const SHIFT_LATCH_DURATION_MS = 2000;
export const CREATE_CHORD_HOLD_MS = 600;
const USER_CHORD_STORAGE_KEY = 'dixi_pads_user_chord_v1';
const DEFAULT_CHORD_INTERVALS: readonly number[] = [0, 4, 7];

interface ActivePointerNotes {
  padIndex: number;
  notes: number[];
}

export class MidiStateEngine {
  private readonly sendPacket: (packet: MidiPacket) => void;
  private readonly onChange: (snapshot: ControlSurfaceSnapshot) => void;

  private channel = 0; // 0..15 (default 0 = MIDI Channel 1)
  private octaveOffset = 0;
  private semitoneOffset = 0;

  // Smart hybrid Shift state
  private shiftHeld = false;
  private shiftLatched = false;
  private shiftDownTime = 0;
  private shiftUsedInCombo = false;
  private shiftLatchTimer: ReturnType<typeof setTimeout> | null = null;
  private shiftTappedWhileLatched = false;

  // Hold / Chord / Create Chord state
  private holdMode = false;
  private chordMode = false;
  private isCreatingChord = false;
  private chordIntervals: number[] = [...DEFAULT_CHORD_INTERVALS];
  private recordedChordNotes: Set<number> = new Set();
  private holdDownWithShift = false;
  private holdCreateTimer: ReturnType<typeof setTimeout> | null = null;
  private holdPressed = false;

  // Octave simultaneous reset tracking
  private octDownHeld = false;
  private octUpHeld = false;
  private octResetConsumed = false;

  // Physical and latched note tracking
  private readonly physicalHoldCount = new Int32Array(128);
  private totalPhysicalCount = 0;
  private readonly sustainedNotes = new Set<number>();
  private readonly pointerNotes = new Map<number, ActivePointerNotes>();
  private readonly padPhysicalCount = new Int32Array(12);
  private readonly padLatchedCount = new Int32Array(12);
  private readonly noteToPadHints = new Map<number, Set<number>>();

  // Touch strips
  private pitchNormalized = 0.5;
  private modNormalized = 0.0;
  private lastPitch14 = 8192;
  private lastModCC = 0;

  constructor(
    sendPacket: (packet: MidiPacket) => void,
    onChange: (snapshot: ControlSurfaceSnapshot) => void
  ) {
    this.sendPacket = sendPacket;
    this.onChange = onChange;
    this.chordIntervals = this.loadPersistedChord();
  }

  private loadPersistedChord(): number[] {
    try {
      if (typeof localStorage === 'undefined') return [...DEFAULT_CHORD_INTERVALS];
      const raw = localStorage.getItem(USER_CHORD_STORAGE_KEY);
      if (!raw) return [...DEFAULT_CHORD_INTERVALS];
      const parsed = JSON.parse(raw);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 127)
      ) {
        return Array.from(new Set(parsed)).sort((a, b) => a - b);
      }
    } catch {
      // Ignore storage failures
    }
    return [...DEFAULT_CHORD_INTERVALS];
  }

  private persistChord(intervals: number[]): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(USER_CHORD_STORAGE_KEY, JSON.stringify(intervals));
      }
    } catch {
      // Ignore storage failures
    }
  }

  private isShiftActive(): boolean {
    return this.shiftHeld || this.shiftLatched;
  }

  private clearShiftLatchTimer(): void {
    if (this.shiftLatchTimer !== null) {
      clearTimeout(this.shiftLatchTimer);
      this.shiftLatchTimer = null;
    }
  }

  private clearShiftLatch(): void {
    this.clearShiftLatchTimer();
    this.shiftLatched = false;
  }

  private clearHoldCreateTimer(): void {
    if (this.holdCreateTimer !== null) {
      clearTimeout(this.holdCreateTimer);
      this.holdCreateTimer = null;
    }
  }

  private getBaseMidiNote(): number {
    const raw = DEFAULT_BASE_MIDI_NOTE + this.octaveOffset * 12 + this.semitoneOffset;
    return Math.max(0, Math.min(127, raw));
  }

  private computePadNotes(padIndex: number): number[] {
    const rootNote = DEFAULT_BASE_MIDI_NOTE + this.octaveOffset * 12 + this.semitoneOffset + padIndex;
    if (!this.chordMode || this.isCreatingChord) {
      return rootNote >= 0 && rootNote <= 127 ? [rootNote] : [];
    }
    const notes: number[] = [];
    for (let i = 0; i < this.chordIntervals.length; i++) {
      const candidate = rootNote + this.chordIntervals[i];
      if (candidate >= 0 && candidate <= 127) {
        notes.push(candidate);
      }
    }
    return notes;
  }

  // --- Shift Button (⌘) ---
  public onShiftDown(now: number = performance.now()): void {
    if (this.shiftLatched) {
      this.clearShiftLatch();
      this.shiftHeld = false;
      this.shiftTappedWhileLatched = true;
      this.emitChange();
      return;
    }

    this.shiftTappedWhileLatched = false;
    this.shiftHeld = true;
    this.shiftDownTime = now;
    this.shiftUsedInCombo = false;
    this.emitChange();
  }

  public onShiftUp(now: number = performance.now()): void {
    if (this.shiftTappedWhileLatched) {
      this.shiftTappedWhileLatched = false;
      this.shiftHeld = false;
      this.emitChange();
      return;
    }

    const heldDuration = now - this.shiftDownTime;
    this.shiftHeld = false;

    if (!this.shiftUsedInCombo && heldDuration < SHIFT_TAP_WINDOW_MS) {
      this.clearShiftLatchTimer();
      this.shiftLatched = true;
      this.shiftLatchTimer = setTimeout(() => {
        this.shiftLatched = false;
        this.shiftLatchTimer = null;
        this.emitChange();
      }, SHIFT_LATCH_DURATION_MS);
    } else {
      this.clearShiftLatch();
    }

    this.emitChange();
  }

  // --- Hold / Chord Button (∞) ---
  public onHoldDown(): void {
    this.holdPressed = true;
    if (this.isShiftActive()) {
      this.shiftUsedInCombo = true;
      this.clearShiftLatch();
      this.holdDownWithShift = true;
      this.recordedChordNotes.clear();
      this.clearHoldCreateTimer();
      this.holdCreateTimer = setTimeout(() => {
        if (this.holdPressed && this.holdDownWithShift) {
          this.isCreatingChord = true;
          this.emitChange();
        }
      }, CREATE_CHORD_HOLD_MS);
      this.emitChange();
      return;
    }

    this.holdDownWithShift = false;
    this.holdMode = !this.holdMode;

    if (!this.holdMode) {
      this.releaseUnheldSustainedNotes();
    }
    this.emitChange();
  }

  public onHoldUp(): void {
    this.holdPressed = false;
    if (!this.holdDownWithShift) {
      return;
    }

    this.clearHoldCreateTimer();
    this.holdDownWithShift = false;

    if (this.isCreatingChord) {
      this.isCreatingChord = false;
      if (this.recordedChordNotes.size > 0) {
        const sorted = Array.from(this.recordedChordNotes).sort((a, b) => a - b);
        const minNote = sorted[0];
        const intervals = Array.from(new Set(sorted.map((n) => n - minNote))).sort((a, b) => a - b);
        this.chordIntervals = intervals;
        this.persistChord(intervals);
        this.chordMode = true;
      }
      this.recordedChordNotes.clear();
      this.emitChange();
      return;
    }

    // Short tap (< 600ms) with Shift: Toggle Chord Mode
    this.chordMode = !this.chordMode;
    this.emitChange();
  }

  // --- Octave / Semitone Buttons (− / +) ---
  public onOctDownPress(): void {
    this.octDownHeld = true;
    if (this.octUpHeld) {
      this.performSimultaneousReset();
      return;
    }
    this.octResetConsumed = false;

    if (this.isShiftActive()) {
      this.shiftUsedInCombo = true;
      this.clearShiftLatch();
      this.semitoneOffset = Math.max(MIN_SEMITONE_OFFSET, this.semitoneOffset - 1);
    } else {
      this.octaveOffset = Math.max(MIN_OCTAVE_OFFSET, this.octaveOffset - 1);
    }
    this.emitChange();
  }

  public onOctDownRelease(): void {
    this.octDownHeld = false;
    if (!this.octUpHeld) {
      this.octResetConsumed = false;
    }
  }

  public onOctUpPress(): void {
    this.octUpHeld = true;
    if (this.octDownHeld) {
      this.performSimultaneousReset();
      return;
    }
    this.octResetConsumed = false;

    if (this.isShiftActive()) {
      this.shiftUsedInCombo = true;
      this.clearShiftLatch();
      this.semitoneOffset = Math.min(MAX_SEMITONE_OFFSET, this.semitoneOffset + 1);
    } else {
      this.octaveOffset = Math.min(MAX_OCTAVE_OFFSET, this.octaveOffset + 1);
    }
    this.emitChange();
  }

  public onOctUpRelease(): void {
    this.octUpHeld = false;
    if (!this.octDownHeld) {
      this.octResetConsumed = false;
    }
  }

  private performSimultaneousReset(): void {
    if (this.octResetConsumed) return;
    this.octResetConsumed = true;
    if (this.isShiftActive()) {
      this.shiftUsedInCombo = true;
      this.clearShiftLatch();
    }
    this.octaveOffset = 0;
    this.semitoneOffset = 0;
    this.emitChange();
  }

  // --- Pad Pointer Engine ---
  public onPadPointerDown(pointerId: number, padIndex: number, velocity: number): void {
    if (padIndex < 0 || padIndex >= 12) return;

    // If Shift + ∞ is held and user starts hitting pads before 600ms, enter Create Chord immediately
    if (this.holdPressed && this.holdDownWithShift && !this.isCreatingChord) {
      this.clearHoldCreateTimer();
      this.isCreatingChord = true;
    }

    // Shift + Pad (when not recording a chord) -> Switch MIDI Channel 1..12
    if (this.isShiftActive() && !this.isCreatingChord) {
      this.shiftUsedInCombo = true;
      this.clearShiftLatch();
      const targetChannel = padIndex; // 0..11 -> Channels 1..12
      if (targetChannel !== this.channel) {
        this.releaseAllSoundingNotes();
        this.channel = targetChannel;
      }
      this.emitChange();
      return;
    }

    const notes = this.computePadNotes(padIndex);
    if (notes.length === 0) return;

    if (this.isCreatingChord) {
      for (let i = 0; i < notes.length; i++) {
        this.recordedChordNotes.add(notes[i]);
      }
    }

    this.triggerPadNotesForPointer(pointerId, padIndex, notes, velocity);
    this.emitChange();
  }

  public onPadPointerMove(pointerId: number, padIndex: number | null, velocity: number): void {
    const existing = this.pointerNotes.get(pointerId);

    // Dragged off the pad grid cleanly releases that pointer's notes
    if (padIndex === null || padIndex < 0 || padIndex >= 12) {
      if (existing) {
        this.releasePointerNotes(pointerId);
        this.emitChange();
      }
      return;
    }

    // Still on the same pad
    if (existing && existing.padIndex === padIndex) {
      return;
    }

    // Ignore channel switch mode on drag if Shift is active
    if (this.isShiftActive() && !this.isCreatingChord) {
      return;
    }

    if (existing) {
      this.releasePointerNotes(pointerId);
    }

    const notes = this.computePadNotes(padIndex);
    if (notes.length > 0) {
      if (this.isCreatingChord) {
        for (let i = 0; i < notes.length; i++) {
          this.recordedChordNotes.add(notes[i]);
        }
      }
      this.triggerPadNotesForPointer(pointerId, padIndex, notes, velocity);
    }
    this.emitChange();
  }

  public onPadPointerUp(pointerId: number): void {
    if (!this.pointerNotes.has(pointerId)) return;
    this.releasePointerNotes(pointerId);
    this.emitChange();
  }

  private triggerPadNotesForPointer(
    pointerId: number,
    padIndex: number,
    notes: number[],
    velocity: number
  ): void {
    // Simultaneous Latching Rule for Hold Mode:
    // When all fingers were lifted (totalPhysicalCount === 0) and a new pad/chord is struck,
    // immediately send Note Off for all previously latched notes before latching the newly played notes.
    if (this.holdMode && this.totalPhysicalCount === 0 && this.sustainedNotes.size > 0) {
      for (const sustainedNote of Array.from(this.sustainedNotes)) {
        this.sendPacket(buildNoteOff(this.channel, sustainedNote));
        this.sustainedNotes.delete(sustainedNote);
      }
      this.padLatchedCount.fill(0);
      this.noteToPadHints.clear();
    }

    this.pointerNotes.set(pointerId, { padIndex, notes });
    this.padPhysicalCount[padIndex]++;

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      this.physicalHoldCount[note]++;
      this.totalPhysicalCount++;

      if (this.holdMode) {
        this.sustainedNotes.add(note);
        let hints = this.noteToPadHints.get(note);
        if (!hints) {
          hints = new Set<number>();
          this.noteToPadHints.set(note, hints);
        }
        if (!hints.has(padIndex)) {
          hints.add(padIndex);
          this.padLatchedCount[padIndex]++;
        }
      }

      this.sendPacket(buildNoteOn(this.channel, note, velocity));
    }
  }

  private releasePointerNotes(pointerId: number): void {
    const entry = this.pointerNotes.get(pointerId);
    if (!entry) return;
    this.pointerNotes.delete(pointerId);

    if (this.padPhysicalCount[entry.padIndex] > 0) {
      this.padPhysicalCount[entry.padIndex]--;
    }

    for (let i = 0; i < entry.notes.length; i++) {
      const note = entry.notes[i];
      if (this.physicalHoldCount[note] > 0) {
        this.physicalHoldCount[note]--;
        this.totalPhysicalCount = Math.max(0, this.totalPhysicalCount - 1);
      }

      if (this.physicalHoldCount[note] === 0 && !this.holdMode) {
        this.sendPacket(buildNoteOff(this.channel, note));
        this.sustainedNotes.delete(note);
      }
    }
  }

  private releaseUnheldSustainedNotes(): void {
    for (const note of Array.from(this.sustainedNotes)) {
      if (this.physicalHoldCount[note] === 0) {
        this.sendPacket(buildNoteOff(this.channel, note));
        this.sustainedNotes.delete(note);
      }
    }
    this.recomputePadLatchedCounts();
  }

  private recomputePadLatchedCounts(): void {
    this.padLatchedCount.fill(0);
    for (const [note, hints] of this.noteToPadHints.entries()) {
      if (!this.sustainedNotes.has(note)) {
        this.noteToPadHints.delete(note);
        continue;
      }
      for (const padIdx of hints) {
        this.padLatchedCount[padIdx]++;
      }
    }
  }

  private releaseAllSoundingNotes(): void {
    const notesToRelease = new Set<number>();
    for (let note = 0; note < 128; note++) {
      if (this.physicalHoldCount[note] > 0) {
        notesToRelease.add(note);
      }
      this.physicalHoldCount[note] = 0;
    }
    for (const note of this.sustainedNotes) {
      notesToRelease.add(note);
    }

    for (const note of notesToRelease) {
      this.sendPacket(buildNoteOff(this.channel, note));
    }

    this.totalPhysicalCount = 0;
    this.sustainedNotes.clear();
    this.pointerNotes.clear();
    this.padPhysicalCount.fill(0);
    this.padLatchedCount.fill(0);
    this.noteToPadHints.clear();
  }

  // --- Touch Strips ---
  public onPitchStripMove(normalized: number): void {
    const clamped = Math.max(0, Math.min(1, normalized));
    this.pitchNormalized = clamped;
    // Exact center 0.5 -> 8192
    const val14 =
      Math.abs(clamped - 0.5) < 1e-6 ? 8192 : Math.round(clamped * 16383);
    this.lastPitch14 = val14;
    this.sendPacket(buildPitchBend(this.channel, val14));
    this.emitChange();
  }

  public onPitchStripRelease(): void {
    this.pitchNormalized = 0.5;
    if (this.lastPitch14 !== 8192) {
      this.lastPitch14 = 8192;
    }
    // Always snap MIDI back to center 8192 immediately on release
    this.sendPacket(buildPitchBend(this.channel, 8192));
    this.emitChange();
  }

  public onModStripMove(normalized: number): void {
    const clamped = Math.max(0, Math.min(1, normalized));
    this.modNormalized = clamped;
    const cc = Math.round(clamped * 127);
    this.lastModCC = cc;
    this.sendPacket(buildModulation(this.channel, this.lastModCC));
    this.emitChange();
  }

  // --- LED State Derivation ---
  private computeDirectionLed(isUp: boolean): LedColorState {
    const octActive = isUp ? this.octaveOffset > 0 : this.octaveOffset < 0;
    const semiActive = isUp ? this.semitoneOffset > 0 : this.semitoneOffset < 0;
    if (octActive && semiActive) return 'pulse';
    if (octActive) return 'white';
    if (semiActive) return 'blue';
    return 'off';
  }

  private computeHoldLed(): LedColorState {
    if (this.isCreatingChord) return 'pulse';
    if (this.holdMode && this.chordMode) return 'pulse';
    if (this.holdMode) return 'white';
    if (this.chordMode) return 'blue';
    return 'off';
  }

  public getSnapshot(): ControlSurfaceSnapshot {
    const baseMidiNote = this.getBaseMidiNote();
    const activePads = Array.from({ length: 12 }, (_, i) => this.padPhysicalCount[i] > 0);
    const latchedPads = Array.from({ length: 12 }, (_, i) => this.padLatchedCount[i] > 0);

    return {
      channel: this.channel,
      octaveOffset: this.octaveOffset,
      semitoneOffset: this.semitoneOffset,
      baseMidiNote,
      baseNoteLabel: midiNoteToName(baseMidiNote),
      shiftActive: this.isShiftActive(),
      holdMode: this.holdMode,
      chordMode: this.chordMode,
      isCreatingChord: this.isCreatingChord,
      chordIntervals: [...this.chordIntervals],
      shiftLed: this.isShiftActive() ? 'white' : 'off',
      holdLed: this.computeHoldLed(),
      octDownLed: this.computeDirectionLed(false),
      octUpLed: this.computeDirectionLed(true),
      pitchNormalized: this.pitchNormalized,
      modNormalized: this.modNormalized,
      activePads,
      latchedPads,
    };
  }

  private emitChange(): void {
    this.onChange(this.getSnapshot());
  }

  public dispose(): void {
    this.clearShiftLatchTimer();
    this.clearHoldCreateTimer();
    this.releaseAllSoundingNotes();
  }
}
