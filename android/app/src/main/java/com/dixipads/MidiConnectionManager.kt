package com.dixipads

import android.content.Context
import android.media.midi.MidiDevice
import android.media.midi.MidiDeviceInfo
import android.media.midi.MidiInputPort
import android.media.midi.MidiManager
import android.os.Handler
import android.os.Looper

class MidiConnectionManager(context: Context) {
    private val midiManager = context.getSystemService(Context.MIDI_SERVICE) as? MidiManager
    private val mainHandler = Handler(Looper.getMainLooper())
    private val openPorts = mutableMapOf<Int, Pair<MidiDevice, MidiInputPort>>()

    private val deviceCallback = object : MidiManager.DeviceCallback() {
        override fun onDeviceAdded(device: MidiDeviceInfo) {
            openInputPortsForDevice(device)
        }

        override fun onDeviceRemoved(device: MidiDeviceInfo) {
            closeDevicePorts(device.id)
        }
    }

    fun start() {
        val manager = midiManager ?: return
        manager.registerDeviceCallback(deviceCallback, mainHandler)
        @Suppress("DEPRECATION")
        manager.devices.forEach { info -> openInputPortsForDevice(info) }
    }

    fun stop() {
        val manager = midiManager ?: return
        manager.unregisterDeviceCallback(deviceCallback)
        openPorts.values.forEach { (device, port) ->
            runCatching { port.close() }
            runCatching { device.close() }
        }
        openPorts.clear()
    }

    fun send(packet: ByteArray) {
        val timestamp = System.nanoTime()
        // Send to virtual Android MIDI output port (for USB-C MIDI gadget / DAW routing)
        DixiMidiDeviceService.sendMidi(packet, timestamp)
        // Also forward to any directly attached MIDI input ports (USB OTG / host mode)
        for ((_, pair) in openPorts) {
            runCatching {
                pair.second.send(packet, 0, packet.size, timestamp)
            }
        }
    }

    private fun openInputPortsForDevice(info: MidiDeviceInfo) {
        if (openPorts.containsKey(info.id)) return
        if (info.inputPortCount <= 0) return

        midiManager?.openDevice(info, { device ->
            if (device == null) return@openDevice
            val port = device.openInputPort(0)
            if (port != null) {
                openPorts[info.id] = device to port
            } else {
                runCatching { device.close() }
            }
        }, mainHandler)
    }

    private fun closeDevicePorts(deviceId: Int) {
        openPorts.remove(deviceId)?.let { (device, port) ->
            runCatching { port.close() }
            runCatching { device.close() }
        }
    }
}
