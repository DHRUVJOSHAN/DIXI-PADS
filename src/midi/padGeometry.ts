export interface PadRect {
  padIndex: number;
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PAD_COLS = 4;
export const PAD_ROWS = 3;
export const TOTAL_PADS = PAD_COLS * PAD_ROWS; // 12 pads

/**
 * MPC-style bottom-to-top pad ordering:
 * Top row (visual row 0):    Pad 9 (8), Pad 10 (9), Pad 11 (10), Pad 12 (11)
 * Middle row (visual row 1): Pad 5 (4), Pad 6 (5),  Pad 7 (6),   Pad 8 (7)
 * Bottom row (visual row 2): Pad 1 (0), Pad 2 (1),  Pad 3 (2),   Pad 4 (3)
 */
export function visualSlotToPadIndex(visualRow: number, visualCol: number): number {
  const logicalRow = PAD_ROWS - 1 - visualRow;
  return logicalRow * PAD_COLS + visualCol;
}

export function padIndexToVisualSlot(padIndex: number): { visualRow: number; visualCol: number } {
  const logicalRow = Math.floor(padIndex / PAD_COLS);
  const visualCol = padIndex % PAD_COLS;
  const visualRow = PAD_ROWS - 1 - logicalRow;
  return { visualRow, visualCol };
}

export function getPadRect(
  padIndex: number,
  bedWidth: number,
  bedHeight: number,
  paddingX: number,
  paddingY: number,
  gap: number
): PadRect {
  const { visualRow, visualCol } = padIndexToVisualSlot(padIndex);
  const innerWidth = Math.max(0, bedWidth - paddingX * 2 - gap * (PAD_COLS - 1));
  const innerHeight = Math.max(0, bedHeight - paddingY * 2 - gap * (PAD_ROWS - 1));
  const padWidth = innerWidth / PAD_COLS;
  const padHeight = innerHeight / PAD_ROWS;

  return {
    padIndex,
    col: visualCol,
    row: visualRow,
    x: paddingX + visualCol * (padWidth + gap),
    y: paddingY + visualRow * (padHeight + gap),
    width: padWidth,
    height: padHeight,
  };
}

export function hitTestPad(
  localX: number,
  localY: number,
  bedWidth: number,
  bedHeight: number,
  paddingX: number,
  paddingY: number,
  gap: number
): PadRect | null {
  if (localX < 0 || localY < 0 || localX > bedWidth || localY > bedHeight) {
    return null;
  }

  for (let padIndex = 0; padIndex < TOTAL_PADS; padIndex++) {
    const rect = getPadRect(padIndex, bedWidth, bedHeight, paddingX, paddingY, gap);
    if (
      localX >= rect.x &&
      localX <= rect.x + rect.width &&
      localY >= rect.y &&
      localY <= rect.y + rect.height
    ) {
      return rect;
    }
  }

  return null;
}
