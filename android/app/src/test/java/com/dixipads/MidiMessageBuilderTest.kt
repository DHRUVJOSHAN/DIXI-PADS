package com.dixipads

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class MidiMessageBuilderTest {
    @Test
    fun noteOnAndOffPacketsMatchSpec() {
        assertArrayEquals(byteArrayOf(0x90.toByte(), 36, 100), MidiMessageBuilder.noteOn(0, 36, 100))
        assertArrayEquals(byteArrayOf(0x82.toByte(), 47, 0), MidiMessageBuilder.noteOff(2, 47))
    }

    @Test
    fun pitchBendEncodingMatches14BitSpec() {
        assertArrayEquals(byteArrayOf(0xE0.toByte(), 0x00, 0x40), MidiMessageBuilder.pitchBend(0, 8192))
        assertArrayEquals(byteArrayOf(0xE0.toByte(), 0x7F, 0x7F), MidiMessageBuilder.pitchBend(0, 16383))
        assertArrayEquals(byteArrayOf(0xE0.toByte(), 0x00, 0x00), MidiMessageBuilder.pitchBend(0, 0))
    }

    @Test
    fun modulationEncodingUsesCC1() {
        assertArrayEquals(byteArrayOf(0xB1.toByte(), 0x01, 127), MidiMessageBuilder.modulation(1, 127))
    }

    @Test
    fun midiNoteNamesMatchStandardOctaves() {
        assertEquals("C2", MidiMessageBuilder.midiNoteToName(36))
        assertEquals("C4", MidiMessageBuilder.midiNoteToName(60))
    }
}
