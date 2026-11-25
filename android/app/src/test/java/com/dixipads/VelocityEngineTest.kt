package com.dixipads

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VelocityEngineTest {
    @Test
    fun topEdgeProducesMinimumVelocityRange() {
        val vel = VelocityEngine.computePadVelocity(touchY = 100f, padTop = 100f, padHeight = 200f, randomUnit = 0.5f)
        assertEquals(30, vel)
    }

    @Test
    fun bottomEdgeProducesMaximumVelocityRange() {
        val vel = VelocityEngine.computePadVelocity(touchY = 300f, padTop = 100f, padHeight = 200f, randomUnit = 0.5f)
        assertEquals(127, vel)
    }

    @Test
    fun velocityStrictlyClampedBetween30And127() {
        for (y in -50..500 step 25) {
            for (r in listOf(0f, 0.25f, 0.5f, 0.99f)) {
                val v = VelocityEngine.computePadVelocity(y.toFloat(), 100f, 200f, r)
                assertTrue("Velocity out of bounds: $v", v in 30..127)
            }
        }
    }
}
