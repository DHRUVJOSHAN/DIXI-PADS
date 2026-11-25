import React, { useRef } from 'react';
import {
  PAD_COLS,
  PAD_ROWS,
  hitTestPad,
  visualSlotToPadIndex,
} from '../midi/padGeometry';
import { computePadVelocity } from '../midi/velocityEngine';
import type { ControlSurfaceSnapshot, MidiStateEngine } from '../midi/midiStateEngine';

interface PadMatrixProps {
  snapshot: ControlSurfaceSnapshot;
  engine: MidiStateEngine;
}

const BED_PADDING_X = 16;
const BED_PADDING_Y = 16;
const PAD_GAP = 14;

export const PadMatrix: React.FC<PadMatrixProps> = ({ snapshot, engine }) => {
  const bedRef = useRef<HTMLDivElement | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const bed = bedRef.current;
    if (!bed) return;

    bed.setPointerCapture(e.pointerId);
    const rect = bed.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    const hit = hitTestPad(
      localX,
      localY,
      rect.width,
      rect.height,
      BED_PADDING_X,
      BED_PADDING_Y,
      PAD_GAP
    );

    if (hit) {
      const velocity = computePadVelocity(localY, hit.y, hit.height);
      engine.onPadPointerDown(e.pointerId, hit.padIndex, velocity);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const bed = bedRef.current;
    if (!bed) return;
    if (!bed.hasPointerCapture(e.pointerId)) return;

    e.preventDefault();
    const rect = bed.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    const hit = hitTestPad(
      localX,
      localY,
      rect.width,
      rect.height,
      BED_PADDING_X,
      BED_PADDING_Y,
      PAD_GAP
    );

    if (hit) {
      const velocity = computePadVelocity(localY, hit.y, hit.height);
      engine.onPadPointerMove(e.pointerId, hit.padIndex, velocity);
    } else {
      engine.onPadPointerMove(e.pointerId, null, 64);
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const bed = bedRef.current;
    if (bed && bed.hasPointerCapture(e.pointerId)) {
      bed.releasePointerCapture(e.pointerId);
    }
    engine.onPadPointerUp(e.pointerId);
  };

  // Build 4x3 grid in visual row-major order (top row Pads 9..12 -> bottom row Pads 1..4)
  const slots: number[] = [];
  for (let visualRow = 0; visualRow < PAD_ROWS; visualRow++) {
    for (let visualCol = 0; visualCol < PAD_COLS; visualCol++) {
      slots.push(visualSlotToPadIndex(visualRow, visualCol));
    }
  }

  return (
    <main
      className="relative w-full h-full select-none touch-none"
      style={{
        background: 'linear-gradient(180deg, #F3CFD9 0%, #EAC2CE 100%)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div
        ref={bedRef}
        className="w-full h-full grid grid-cols-4 grid-rows-3"
        style={{
          padding: `${BED_PADDING_Y}px ${BED_PADDING_X}px`,
          gap: `${PAD_GAP}px`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
      >
        {slots.map((padIndex) => {
          const isPressed = snapshot.activePads[padIndex];
          const isLatched = snapshot.latchedPads[padIndex];
          const isLit = isPressed || isLatched;

          return (
            <div
              key={padIndex}
              className={`relative w-full h-full rounded-[14px] pointer-events-none flex flex-col justify-end items-center ${
                isPressed ? 'dixi-pad-pressed' : 'dixi-pad-spring'
              }`}
              style={{
                background: isPressed
                  ? 'linear-gradient(180deg, #EFEBE3 0%, #E8E1D6 100%)'
                  : 'linear-gradient(180deg, #FDFBF7 0%, #F6F1E9 100%)',
                transform: isPressed
                  ? 'scale(0.968) translateY(2px)'
                  : 'scale(1) translateY(0px)',
                boxShadow: isPressed
                  ? isLatched
                    ? '0 0 0 1.5px rgba(96, 178, 255, 0.72), 0 0 16px rgba(96, 178, 255, 0.35), inset 0 2px 6px rgba(79, 52, 60, 0.14)'
                    : '0 0 0 1.5px rgba(255, 255, 255, 0.92), 0 0 16px rgba(255, 255, 255, 0.52), inset 0 2px 6px rgba(79, 52, 60, 0.14)'
                  : isLatched
                    ? '0 4px 0 rgba(214, 179, 189, 0.72), 0 0 0 1.5px rgba(96, 178, 255, 0.65), 0 0 14px rgba(96, 178, 255, 0.28), inset 0 1px 1px rgba(255, 255, 255, 0.9)'
                    : '0 4px 0 rgba(214, 179, 189, 0.74), 0 6px 14px rgba(79, 52, 60, 0.10), inset 0 0 0 1px rgba(154, 102, 117, 0.18), inset 0 1px 1px rgba(255, 255, 255, 0.9)',
              }}
            >
              {/* Subtle top silicone LED bar inside each pad */}
              <div
                className="absolute top-[10px] left-[28%] right-[28%] h-[3px] rounded-full transition-all duration-150"
                style={{
                  backgroundColor: isPressed
                    ? '#FFFFFF'
                    : isLatched
                      ? '#7CC3FF'
                      : 'rgba(154, 102, 117, 0.16)',
                  boxShadow: isPressed
                    ? '0 0 10px 2px rgba(255, 255, 255, 0.95)'
                    : isLatched
                      ? '0 0 10px 2px rgba(92, 175, 255, 0.78)'
                      : 'none',
                  opacity: isLit ? 1 : 0.75,
                }}
              />
            </div>
          );
        })}
      </div>
    </main>
  );
};
