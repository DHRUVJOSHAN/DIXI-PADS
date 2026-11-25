package com.dixipads

import android.graphics.RectF

data class PadRect(
    val padIndex: Int,
    val col: Int,
    val row: Int,
    val bounds: RectF
)

object PadGeometry {
    const val PAD_COLS = 4
    const val PAD_ROWS = 3
    const val TOTAL_PADS = PAD_COLS * PAD_ROWS

    fun visualSlotToPadIndex(visualRow: Int, visualCol: Int): Int {
        val logicalRow = PAD_ROWS - 1 - visualRow
        return logicalRow * PAD_COLS + visualCol
    }

    fun padIndexToVisualSlot(padIndex: Int): Pair<Int, Int> {
        val logicalRow = padIndex / PAD_COLS
        val visualCol = padIndex % PAD_COLS
        val visualRow = PAD_ROWS - 1 - logicalRow
        return visualRow to visualCol
    }

    fun computePadRects(
        bedLeft: Float,
        bedTop: Float,
        bedWidth: Float,
        bedHeight: Float,
        paddingX: Float,
        paddingY: Float,
        gap: Float
    ): List<PadRect> {
        val innerWidth = (bedWidth - paddingX * 2f - gap * (PAD_COLS - 1)).coerceAtLeast(0f)
        val innerHeight = (bedHeight - paddingY * 2f - gap * (PAD_ROWS - 1)).coerceAtLeast(0f)
        val padWidth = innerWidth / PAD_COLS
        val padHeight = innerHeight / PAD_ROWS

        val list = ArrayList<PadRect>(TOTAL_PADS)
        for (padIndex in 0 until TOTAL_PADS) {
            val (visualRow, visualCol) = padIndexToVisualSlot(padIndex)
            val left = bedLeft + paddingX + visualCol * (padWidth + gap)
            val top = bedTop + paddingY + visualRow * (padHeight + gap)
            list.add(
                PadRect(
                    padIndex = padIndex,
                    col = visualCol,
                    row = visualRow,
                    bounds = RectF(left, top, left + padWidth, top + padHeight)
                )
            )
        }
        return list
    }

    fun hitTest(x: Float, y: Float, pads: List<PadRect>): PadRect? {
        for (pad in pads) {
            if (pad.bounds.contains(x, y)) {
                return pad
            }
        }
        return null
    }
}
