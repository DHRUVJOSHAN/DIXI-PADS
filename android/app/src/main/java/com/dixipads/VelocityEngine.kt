package com.dixipads

import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.roundToInt
import kotlin.random.Random

object VelocityEngine {
    const val MIN_VELOCITY = 30
    const val MAX_VELOCITY = 127

    fun computePadVelocity(
        touchY: Float,
        padTop: Float,
        padHeight: Float,
        randomUnit: Float = Random.nextFloat()
    ): Int {
        val safeHeight = padHeight.coerceAtLeast(1f)
        val rawP = ((touchY - padTop) / safeHeight).toDouble().coerceIn(0.0, 1.0)
        val expScale = (exp(3.0 * rawP) - 1.0) / (exp(3.0) - 1.0)
        val base = MIN_VELOCITY + ((MAX_VELOCITY - MIN_VELOCITY) * expScale).roundToInt()

        val jitter = floor((randomUnit.coerceIn(0f, 0.999999f) * 5f)).toInt() - 2
        return (base + jitter).coerceIn(MIN_VELOCITY, MAX_VELOCITY)
    }
}
