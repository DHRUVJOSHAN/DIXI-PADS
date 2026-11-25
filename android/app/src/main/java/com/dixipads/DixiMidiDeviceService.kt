package com.dixipads

import android.media.midi.MidiDeviceService
import android.media.midi.MidiReceiver
import java.util.concurrent.CopyOnWriteArrayList

class DixiMidiDeviceService : MidiDeviceService() {
    companion object {
        private val activeReceivers = CopyOnWriteArrayList<MidiReceiver>()

        fun sendMidi(packet: ByteArray, timestampNs: Long) {
            for (receiver in activeReceivers) {
                runCatching {
                    receiver.send(packet, 0, packet.size, timestampNs)
                }
            }
        }
    }

    override fun onGetInputPortReceivers(): Array<MidiReceiver> = emptyArray()

    override fun onDeviceStatusChanged(status: android.media.midi.MidiDeviceStatus) {
        super.onDeviceStatusChanged(status)
        val receivers = outputPortReceivers
        activeReceivers.clear()
        if (receivers != null) {
            activeReceivers.addAll(receivers)
        }
    }
}
