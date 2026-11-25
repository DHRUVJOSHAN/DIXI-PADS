package com.dixipads

object MidiMessageBuilder {
    fun clampChannel(channel: Int): Int = channel.coerceIn(0, 15)

    fun clampNote(note: Int): Int = note.coerceIn(0, 127)

    fun clampVelocity(velocity: Int): Int = velocity.coerceIn(0, 127)

    fun clampCCValue(value: Int): Int = value.coerceIn(0, 127)

    fun clampPitchBend14(value: Int): Int = value.coerceIn(0, 16383)

    fun noteOn(channel: Int, note: Int, velocity: Int): ByteArray {
        val ch = clampChannel(channel)
        return byteArrayOf(
            (0x90 or ch).toByte(),
            clampNote(note).toByte(),
            clampVelocity(velocity).toByte()
        )
    }

    fun noteOff(channel: Int, note: Int): ByteArray {
        val ch = clampChannel(channel)
        return byteArrayOf(
            (0x80 or ch).toByte(),
            clampNote(note).toByte(),
            0x00.toByte()
        )
    }

    fun pitchBend(channel: Int, value14: Int): ByteArray {
        val ch = clampChannel(channel)
        val clamped = clampPitchBend14(value14)
        val lsb = clamped and 0x7F
        val msb = (clamped shr 7) and 0x7F
        return byteArrayOf(
            (0xE0 or ch).toByte(),
            lsb.toByte(),
            msb.toByte()
        )
    }

    fun modulation(channel: Int, value: Int): ByteArray {
        val ch = clampChannel(channel)
        return byteArrayOf(
            (0xB0 or ch).toByte(),
            0x01.toByte(),
            clampCCValue(value).toByte()
        )
    }

    private val NOTE_NAMES = arrayOf(
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"
    )

    fun midiNoteToName(note: Int): String {
        val clamped = clampNote(note)
        val name = NOTE_NAMES[clamped % 12]
        val octave = (clamped / 12) - 1
        return "$name$octave"
    }
}
