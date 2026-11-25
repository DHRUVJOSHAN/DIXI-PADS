package com.dixipads

import android.app.Activity
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager

class MainActivity : Activity() {
    private lateinit var midiConnectionManager: MidiConnectionManager
    private lateinit var stateController: MidiStateController
    private lateinit var padsView: DixiPadsView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        applySecurityAndWakeFlags()

        midiConnectionManager = MidiConnectionManager(applicationContext)
        stateController = MidiStateController(
            context = applicationContext,
            sendPacket = { packet -> midiConnectionManager.send(packet) }
        )

        padsView = DixiPadsView(this, stateController).apply {
            keepScreenOn = true
        }
        setContentView(padsView)

        configureImmersiveMode()
        configureSystemGestureExclusion()
    }

    override fun onResume() {
        super.onResume()
        applySecurityAndWakeFlags()
        configureImmersiveMode()
        midiConnectionManager.start()
    }

    override fun onPause() {
        super.onPause()
        stateController.releaseAllSoundingNotes()
    }

    override fun onDestroy() {
        super.onDestroy()
        stateController.dispose()
        midiConnectionManager.stop()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            configureImmersiveMode()
        }
    }

    private fun applySecurityAndWakeFlags() {
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SECURE
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(false)
        }
    }

    private fun configureImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                )
        }
    }

    private fun configureSystemGestureExclusion() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            padsView.addOnLayoutChangeListener { view, left, top, right, bottom, _, _, _, _ ->
                view.systemGestureExclusionRects = listOf(Rect(left, top, right, bottom))
            }
        }
    }
}
