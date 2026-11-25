import { useEffect, useMemo, useRef, useState } from 'react';
import { PadMatrix } from './components/PadMatrix';
import { MidiStateEngine, type ControlSurfaceSnapshot } from './midi/midiStateEngine';
import { WebMidiTransport } from './midi/webMidiTransport';

export default function App() {
  const transportRef = useRef<WebMidiTransport | null>(null);
  if (!transportRef.current) {
    transportRef.current = new WebMidiTransport();
  }

  const [snapshot, setSnapshot] = useState<ControlSurfaceSnapshot | null>(null);

  const engine = useMemo(() => {
    const transport = transportRef.current!;
    return new MidiStateEngine(
      (packet) => transport.send(packet),
      (nextSnapshot) => setSnapshot(nextSnapshot)
    );
  }, []);

  const currentSnapshot = snapshot ?? engine.getSnapshot();

  // Initialize Web MIDI transport and clean up on unmount
  useEffect(() => {
    const transport = transportRef.current!;
    void transport.init();

    return () => {
      engine.dispose();
      transport.dispose();
    };
  }, [engine]);

  // Always-Awake Screen Wake Lock + re-acquire on visibilitychange
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquireWakeLock = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

      try {
        wakeLock = await navigator.wakeLock.request('screen');
      } catch {
        // Browsers may require a user gesture before granting wake lock
      }
    };

    void acquireWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void acquireWakeLock();
      }
    };

    const handleFirstGesture = () => {
      void acquireWakeLock();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pointerdown', handleFirstGesture, { passive: true });

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pointerdown', handleFirstGesture);
      if (wakeLock) {
        void wakeLock.release().catch(() => {});
      }
    };
  }, []);

  // Capture / Screenshot / Context Menu Suppression
  useEffect(() => {
    const suppressContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const suppressCaptureKeys = (e: KeyboardEvent) => {
      if (
        e.key === 'PrintScreen' ||
        ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 's'))
      ) {
        e.preventDefault();
      }
    };

    window.addEventListener('contextmenu', suppressContextMenu);
    window.addEventListener('keydown', suppressCaptureKeys);

    return () => {
      window.removeEventListener('contextmenu', suppressContextMenu);
      window.removeEventListener('keydown', suppressCaptureKeys);
    };
  }, []);

  return (
    <div className="w-screen h-[100dvh] overflow-hidden select-none touch-none">
      <PadMatrix snapshot={currentSnapshot} engine={engine} />
    </div>
  );
}
