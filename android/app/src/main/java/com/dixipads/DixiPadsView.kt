package com.dixipads

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.view.MotionEvent
import android.view.View
import kotlin.math.abs

class DixiPadsView(
    context: Context,
    private val controller: MidiStateController
) : View(context) {

    private var lastFrameNanos = 0L

    // Spring physics state for 12 pads (stiffness = 400, damping = 25)
    private val padScale = FloatArray(12) { 1f }
    private val padVel = FloatArray(12) { 0f }

    private val bedRect = RectF()
    private var padRects: List<PadRect> = emptyList()
    private val padPointerSet = HashSet<Int>()

    private val bedPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val padPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val padShadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(185, 214, 179, 189)
    }
    private val padStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f
    }
    private val padLedPaint = Paint(Paint.ANTI_ALIAS_FLAG)

    init {
        controller.onStateChanged = {
            postInvalidateOnAnimation()
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val widthF = w.toFloat()
        val heightF = h.toFloat()

        bedRect.set(0f, 0f, widthF, heightF)
        bedPaint.shader = LinearGradient(
            0f, 0f, 0f, heightF,
            Color.parseColor("#F3CFD9"),
            Color.parseColor("#EAC2CE"),
            Shader.TileMode.CLAMP
        )

        val bedPad = (heightF * 0.032f).coerceAtLeast(14f)
        val padGap = (heightF * 0.028f).coerceAtLeast(12f)
        padRects = PadGeometry.computePadRects(
            bedLeft = 0f,
            bedTop = 0f,
            bedWidth = widthF,
            bedHeight = heightF,
            paddingX = bedPad,
            paddingY = bedPad,
            gap = padGap
        )
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val now = System.nanoTime()
        val dt = if (lastFrameNanos == 0L) 0.016f else ((now - lastFrameNanos) / 1_000_000_000f).coerceIn(0.001f, 0.05f)
        lastFrameNanos = now

        var needsMoreFrames = false

        canvas.drawRect(bedRect, bedPaint)

        for (pad in padRects) {
            val idx = pad.padIndex
            val isPressed = controller.padPhysicalCount[idx] > 0

            val targetScale = if (isPressed) 0.968f else 1f
            val force = (targetScale - padScale[idx]) * 400f - padVel[idx] * 25f
            padVel[idx] += force * dt
            padScale[idx] += padVel[idx] * dt
            if (abs(targetScale - padScale[idx]) > 0.001f || abs(padVel[idx]) > 0.001f) {
                needsMoreFrames = true
            } else {
                padScale[idx] = targetScale
                padVel[idx] = 0f
            }

            val b = pad.bounds
            val cx = b.centerX()
            val cy = b.centerY()
            val radius = (b.height() * 0.08f).coerceIn(12f, 22f)

            canvas.save()
            canvas.scale(padScale[idx], padScale[idx], cx, cy)
            if (!isPressed) {
                val shadowRect = RectF(b.left, b.top + 6f, b.right, b.bottom + 6f)
                canvas.drawRoundRect(shadowRect, radius, radius, padShadowPaint)
            } else {
                canvas.translate(0f, 3f)
            }

            padPaint.shader = LinearGradient(
                0f, b.top, 0f, b.bottom,
                Color.parseColor(if (isPressed) "#EFEBE3" else "#FDFBF7"),
                Color.parseColor(if (isPressed) "#E8E1D6" else "#F6F1E9"),
                Shader.TileMode.CLAMP
            )
            canvas.drawRoundRect(b, radius, radius, padPaint)

            padStrokePaint.color = if (isPressed) {
                Color.argb(235, 255, 255, 255)
            } else {
                Color.argb(46, 154, 102, 117)
            }
            canvas.drawRoundRect(b, radius, radius, padStrokePaint)

            padLedPaint.color = if (isPressed) {
                Color.WHITE
            } else {
                Color.argb(40, 154, 102, 117)
            }
            val barW = b.width() * 0.44f
            canvas.drawRoundRect(
                cx - barW / 2f,
                b.top + b.height() * 0.08f,
                cx + barW / 2f,
                b.top + b.height() * 0.08f + 5f,
                3f,
                3f,
                padLedPaint
            )

            canvas.restore()
        }

        if (needsMoreFrames) {
            postInvalidateOnAnimation()
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val action = event.actionMasked
        val pointerIndex = event.actionIndex
        val pointerId = event.getPointerId(pointerIndex)

        when (action) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val x = event.getX(pointerIndex)
                val y = event.getY(pointerIndex)
                padPointerSet.add(pointerId)
                val hit = PadGeometry.hitTest(x, y, padRects)
                if (hit != null) {
                    val vel = VelocityEngine.computePadVelocity(y, hit.bounds.top, hit.bounds.height())
                    controller.onPadPointerDown(pointerId, hit.padIndex, vel)
                }
                invalidate()
            }
            MotionEvent.ACTION_MOVE -> {
                for (i in 0 until event.pointerCount) {
                    val pId = event.getPointerId(i)
                    if (padPointerSet.contains(pId)) {
                        val x = event.getX(i)
                        val y = event.getY(i)
                        val hit = PadGeometry.hitTest(x, y, padRects)
                        if (hit != null) {
                            val vel = VelocityEngine.computePadVelocity(y, hit.bounds.top, hit.bounds.height())
                            controller.onPadPointerMove(pId, hit.padIndex, vel)
                        } else {
                            controller.onPadPointerMove(pId, null, 64)
                        }
                    }
                }
                invalidate()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP, MotionEvent.ACTION_CANCEL -> {
                if (padPointerSet.remove(pointerId)) {
                    controller.onPadPointerUp(pointerId)
                    invalidate()
                }
            }
        }
        return true
    }
}
