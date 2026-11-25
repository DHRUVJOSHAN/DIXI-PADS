import type { MidiPacket } from './midiProtocol';

export class WebMidiTransport {
  private midiAccess: MIDIAccess | null = null;
  private outputs: MIDIOutput[] = [];
  private initialized = false;

  public async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
      return;
    }

    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      this.midiAccess = access;
      this.refreshOutputs();
      access.onstatechange = () => {
        this.refreshOutputs();
      };
    } catch {
      // Silently tolerate browsers or environments where Web MIDI permission is unavailable
    }
  }

  private refreshOutputs(): void {
    if (!this.midiAccess) {
      this.outputs = [];
      return;
    }
    this.outputs = Array.from(this.midiAccess.outputs.values());
  }

  public send(packet: MidiPacket): void {
    if (this.outputs.length === 0) return;
    const bytes = [packet[0], packet[1], packet[2]];
    for (let i = 0; i < this.outputs.length; i++) {
      try {
        this.outputs[i].send(bytes);
      } catch {
        // Ignore transient disconnect errors during hot-unplug
      }
    }
  }

  public dispose(): void {
    if (this.midiAccess) {
      this.midiAccess.onstatechange = null;
    }
    this.outputs = [];
    this.midiAccess = null;
    this.initialized = false;
  }
}
