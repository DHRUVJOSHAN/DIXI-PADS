package com.dixipads

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import kotlin.math.abs
import kotlin.math.roundToInt

enum class LedState {
    OFF,
    WHITE,
    BLUE,
    PULSE
}

class MidiStateController(
    context: Context,
    private val sendPacket: (ByteArray) -> Unit
) {
    companion object {
        const val DEFAULT_BASE_MIDI_NOTE = 36
        const val MIN_OCTAVE_OFFSET = -3
        const val MAX_OCTAVE_OFFSET = 5
        const val MIN_SEMITONE_OFFSET = -12
        const val MAX_SEMITONE_OFFSET = 12
        const val SHIFT_TAP_WINDOW_MS = 400L
        const val SHIFT_LATCH_DURATION_MS = 2000L
        const val CREATE_CHORD_HOLD_MS = 600L
        private const val PREFS_NAME = "dixi_pads_prefs"
        private const val KEY_USER_CHORD = "user_chord_intervals"
    }

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val mainHandler = Handler(Looper.getMainLooper())

    var onStateChanged: (() -> Unit)? = null

    var channel: Int = 0
        private set
    var octaveOffset: Int = 0
        private set
    var semitoneOffset: Int = 0
        private set

    private var shiftHeld = false
    private var shiftLatched = false
    private var shiftDownTimeMs = 0L
    private var shiftUsedInCombo = false
    private var shiftTappedWhileLatched = false
    private val shiftLatchRunnable = Runnable {
        shiftLatched = false
        notifyChanged()
    }

    var holdMode: Boolean = false
        private set
    var chordMode: Boolean = false
        private set
    var isCreatingChord: Boolean = false
        private set

    private var chordIntervals: List<Int> = loadPersistedChord()
    private val recordedChordNotes = LinkedHashSet<Int>()
    private var holdDownWithShift = false
    private var holdPressed = false
    private val holdCreateRunnable = Runnable {
        if (holdPressed && holdDownWithShift) {
            isCreatingChord = true
            notifyChanged()
        }
    }

    private var octDownHeld = false
    private var octUpHeld = false
    private var octResetConsumed = false

    private val physicalHoldCount = IntArray(128)
    private var totalPhysicalCount = 0
    private val sustainedNotes = LinkedHashSet<Int>()
    private val pointerNotes = HashMap<Int, Pair<Int, List<Int>>>()
    val padPhysicalCount = IntArray(12)
    val padLatchedCount = IntArray(12)
    private val noteToPadHints = HashMap<Int, HashSet<Int>>()

    var pitchNormalized: Float = 0.5f
        private set
    var modNormalized: Float = 0.0f
        private set

    val baseMidiNote: Int
        get() = (DEFAULT_BASE_MIDI_NOTE + octaveOffset * 12 + semitoneOffset).coerceIn(0, 127)

    val baseNoteLabel: String
        get() = MidiMessageBuilder.midiNoteToName(baseMidiNote)

    val isShiftActive: Boolean
        get() = shiftHeld || shiftLatched

    val shiftLed: LedState
        get() = if (isShiftActive) LedState.WHITE else LedState.OFF

    val holdLed: LedState
        get() = when {
            isCreatingChord -> LedState.PULSE
            holdMode && chordMode -> LedState.PULSE
            holdMode -> LedState.WHITE
            chordMode -> LedState.BLUE
            else -> LedState.OFF
        }

    val octDownLed: LedState
        get() = directionLed(isUp = false)

    val octUpLed: LedState
        get() = directionLed(isUp = true)

    private fun directionLed(isUp: Boolean): LedState {
        val octActive = if (isUp) octaveOffset > 0 else octaveOffset < 0
        val semiActive = if (isUp) semitoneOffset > 0 else semitoneOffset < 0
        return when {
            octActive && semiActive -> LedState.PULSE
            octActive -> LedState.WHITE
            semiActive -> LedState.BLUE
            else -> LedState.OFF
        }
    }

    private fun loadPersistedChord(): List<Int> {
        val saved = prefs.getString(KEY_USER_CHORD, null) ?: return listOf(0, 4, 7)
        val parsed = saved.split(",")
            .mapNotNull { it.trim().toIntOrNull() }
            .filter { it in 0..127 }
            .distinct()
            .sorted()
        return if (parsed.isNotEmpty()) parsed else listOf(0, 4, 7)
    }

    private fun persistChord(intervals: List<Int>) {
        prefs.edit().putString(KEY_USER_CHORD, intervals.joinToString(",")).apply()
    }

    private fun clearShiftLatch() {
        mainHandler.removeCallbacks(shiftLatchRunnable)
        shiftLatched = false
    }

    private fun computePadNotes(padIndex: Int): List<Int> {
        val rootNote = DEFAULT_BASE_MIDI_NOTE + octaveOffset * 12 + semitoneOffset + padIndex
        if (!chordMode || isCreatingChord) {
            return if (rootNote in 0..127) listOf(rootNote) else emptyList()
        }
        val notes = ArrayList<Int>(chordIntervals.size)
        for (interval in chordIntervals) {
            val candidate = rootNote + interval
            if (candidate in 0..127) {
                notes.add(candidate)
            }
        }
        return notes
    }

    fun onShiftDown() {
        if (shiftLatched) {
            clearShiftLatch()
            shiftHeld = false
            shiftTappedWhileLatched = true
            notifyChanged()
            return
        }
        shiftTappedWhileLatched = false
        shiftHeld = true
        shiftDownTimeMs = SystemClock.uptimeMillis()
        shiftUsedInCombo = false
        notifyChanged()
    }

    fun onShiftUp() {
        if (shiftTappedWhileLatched) {
            shiftTappedWhileLatched = false
            shiftHeld = false
            notifyChanged()
            return
        }
        val heldMs = SystemClock.uptimeMillis() - shiftDownTimeMs
        shiftHeld = false
        if (!shiftUsedInCombo && heldMs < SHIFT_TAP_WINDOW_MS) {
            clearShiftLatch()
            shiftLatched = true
            mainHandler.postDelayed(shiftLatchRunnable, SHIFT_LATCH_DURATION_MS)
        } else {
            clearShiftLatch()
        }
        notifyChanged()
    }

    fun onHoldDown() {
        holdPressed = true
        if (isShiftActive) {
            shiftUsedInCombo = true
            clearShiftLatch()
            holdDownWithShift = true
            recordedChordNotes.clear()
            mainHandler.removeCallbacks(holdCreateRunnable)
            mainHandler.postDelayed(holdCreateRunnable, CREATE_CHORD_HOLD_MS)
            notifyChanged()
            return
        }
        holdDownWithShift = false
        holdMode = !holdMode
        if (!holdMode) {
            releaseUnheldSustainedNotes()
        }
        notifyChanged()
    }

    fun onHoldUp() {
        holdPressed = false
        if (!holdDownWithShift) return
        mainHandler.removeCallbacks(holdCreateRunnable)
        holdDownWithShift = false

        if (isCreatingChord) {
            isCreatingChord = false
            if (recordedChordNotes.isNotEmpty()) {
                val sorted = recordedChordNotes.sorted()
                val minNote = sorted.first()
                val intervals = sorted.map { it - minNote }.distinct().sorted()
                chordIntervals = intervals
                persistChord(intervals)
                chordMode = true
            }
            recordedChordNotes.clear()
            notifyChanged()
            return
        }

        chordMode = !chordMode
        notifyChanged()
    }

    fun onOctDownPress() {
        octDownHeld = true
        if (octUpHeld) {
            performSimultaneousReset()
            return
        }
        octResetConsumed = false
        if (isShiftActive) {
            shiftUsedInCombo = true
            clearShiftLatch()
            semitoneOffset = (semitoneOffset - 1).coerceAtLeast(MIN_SEMITONE_OFFSET)
        } else {
            octaveOffset = (octaveOffset - 1).coerceAtLeast(MIN_OCTAVE_OFFSET)
        }
        notifyChanged()
    }

    fun onOctDownRelease() {
        octDownHeld = false
        if (!octUpHeld) octResetConsumed = false
    }

    fun onOctUpPress() {
        octUpHeld = true
        if (octDownHeld) {
            performSimultaneousReset()
            return
        }
        octResetConsumed = false
        if (isShiftActive) {
            shiftUsedInCombo = true
            clearShiftLatch()
            semitoneOffset = (semitoneOffset + 1).coerceAtMost(MAX_SEMITONE_OFFSET)
        } else {
            octaveOffset = (octaveOffset + 1).coerceAtMost(MAX_OCTAVE_OFFSET)
        }
        notifyChanged()
    }

    fun onOctUpRelease() {
        octUpHeld = false
        if (!octDownHeld) octResetConsumed = false
    }

    private fun performSimultaneousReset() {
        if (octResetConsumed) return
        octResetConsumed = true
        if (isShiftActive) {
            shiftUsedInCombo = true
            clearShiftLatch()
        }
        octaveOffset = 0
        semitoneOffset = 0
        notifyChanged()
    }

    fun onPadPointerDown(pointerId: Int, padIndex: Int, velocity: Int) {
        if (padIndex !in 0..11) return

        if (holdPressed && holdDownWithShift && !isCreatingChord) {
            mainHandler.removeCallbacks(holdCreateRunnable)
            isCreatingChord = true
        }

        if (isShiftActive && !isCreatingChord) {
            shiftUsedInCombo = true
            clearShiftLatch()
            if (padIndex != channel) {
                releaseAllSoundingNotes()
                channel = padIndex
            }
            notifyChanged()
            return
        }

        val notes = computePadNotes(padIndex)
        if (notes.isEmpty()) return

        if (isCreatingChord) {
            recordedChordNotes.addAll(notes)
        }

        triggerPadNotesForPointer(pointerId, padIndex, notes, velocity)
        notifyChanged()
    }

    fun onPadPointerMove(pointerId: Int, padIndex: Int?, velocity: Int) {
        val existing = pointerNotes[pointerId]
        if (padIndex == null || padIndex !in 0..11) {
            if (existing != null) {
                releasePointerNotes(pointerId)
                notifyChanged()
            }
            return
        }

        if (existing != null && existing.first == padIndex) return
        if (isShiftActive && !isCreatingChord) return

        if (existing != null) {
            releasePointerNotes(pointerId)
        }

        val notes = computePadNotes(padIndex)
        if (notes.isNotEmpty()) {
            if (isCreatingChord) {
                recordedChordNotes.addAll(notes)
            }
            triggerPadNotesForPointer(pointerId, padIndex, notes, velocity)
        }
        notifyChanged()
    }

    fun onPadPointerUp(pointerId: Int) {
        if (!pointerNotes.containsKey(pointerId)) return
        releasePointerNotes(pointerId)
        notifyChanged()
    }

    private fun triggerPadNotesForPointer(
        pointerId: Int,
        padIndex: Int,
        notes: List<Int>,
        velocity: Int
    ) {
        if (holdMode && totalPhysicalCount == 0 && sustainedNotes.isNotEmpty()) {
            for (sustainedNote in sustainedNotes.toList()) {
                sendPacket(MidiMessageBuilder.noteOff(channel, sustainedNote))
                sustainedNotes.remove(sustainedNote)
            }
            padLatchedCount.fill(0)
            noteToPadHints.clear()
        }

        pointerNotes[pointerId] = padIndex to notes
        padPhysicalCount[padIndex]++

        for (note in notes) {
            physicalHoldCount[note]++
            totalPhysicalCount++
            if (holdMode) {
                sustainedNotes.add(note)
                val hints = noteToPadHints.getOrPut(note) { HashSet() }
                if (hints.add(padIndex)) {
                    padLatchedCount[padIndex]++
                }
            }
            sendPacket(MidiMessageBuilder.noteOn(channel, note, velocity))
        }
    }

    private fun releasePointerNotes(pointerId: Int) {
        val entry = pointerNotes.remove(pointerId) ?: return
        val (padIndex, notes) = entry
        if (padPhysicalCount[padIndex] > 0) padPhysicalCount[padIndex]--

        for (note in notes) {
            if (physicalHoldCount[note] > 0) {
                physicalHoldCount[note]--
                totalPhysicalCount = (totalPhysicalCount - 1).coerceAtLeast(0)
            }
            if (physicalHoldCount[note] == 0 && !holdMode) {
                sendPacket(MidiMessageBuilder.noteOff(channel, note))
                sustainedNotes.remove(note)
            }
        }
    }

    private fun releaseUnheldSustainedNotes() {
        for (note in sustainedNotes.toList()) {
            if (physicalHoldCount[note] == 0) {
                sendPacket(MidiMessageBuilder.noteOff(channel, note))
                sustainedNotes.remove(note)
            }
        }
        padLatchedCount.fill(0)
        val iter = noteToPadHints.entries.iterator()
        while (iter.hasNext()) {
            val (note, hints) = iter.next()
            if (!sustainedNotes.contains(note)) {
                iter.remove()
            } else {
                for (idx in hints) {
                    padLatchedCount[idx]++
                }
            }
        }
    }

    fun releaseAllSoundingNotes() {
        val toRelease = LinkedHashSet<Int>()
        for (note in 0 until 128) {
            if (physicalHoldCount[note] > 0) toRelease.add(note)
            physicalHoldCount[note] = 0
        }
        toRelease.addAll(sustainedNotes)
        for (note in toRelease) {
            sendPacket(MidiMessageBuilder.noteOff(channel, note))
        }
        totalPhysicalCount = 0
        sustainedNotes.clear()
        pointerNotes.clear()
        padPhysicalCount.fill(0)
        padLatchedCount.fill(0)
        noteToPadHints.clear()
        notifyChanged()
    }

    fun onPitchStripMove(normalized: Float) {
        val clamped = normalized.coerceIn(0f, 1f)
        pitchNormalized = clamped
        val val14 = if (abs(clamped - 0.5f) < 1e-5f) 8192 else (clamped * 16383f).roundToInt()
        sendPacket(MidiMessageBuilder.pitchBend(channel, val14))
        notifyChanged()
    }

    fun onPitchStripRelease() {
        pitchNormalized = 0.5f
        sendPacket(MidiMessageBuilder.pitchBend(channel, 8192))
        notifyChanged()
    }

    fun onModStripMove(normalized: Float) {
        val clamped = normalized.coerceIn(0f, 1f)
        modNormalized = clamped
        val cc = (clamped * 127f).roundToInt()
        sendPacket(MidiMessageBuilder.modulation(channel, cc))
        notifyChanged()
    }

    private fun notifyChanged() {
        onStateChanged?.invoke()
    }

    fun dispose() {
        mainHandler.removeCallbacks(shiftLatchRunnable)
        mainHandler.removeCallbacks(holdCreateRunnable)
        releaseAllSoundingNotes()
    }
}
