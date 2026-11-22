package hu.dragtheblox

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build

/** Valódi kiosk beállítása, ha az app eszköztulajdonos. Egyébként a MainActivity a képernyőrögzítést (screen pinning) használja. */
object Kiosk {
    private fun dpm(ctx: Context) = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    fun isDeviceOwner(ctx: Context): Boolean = try {
        dpm(ctx).isDeviceOwnerApp(ctx.packageName)
    } catch (_: Exception) {
        false
    }

    /** Eszköztulajdonosként engedélyezi az app Lock Task módját, és kikapcsol minden rendszergombot / értesítést. */
    fun prepare(ctx: Context) {
        if (!isDeviceOwner(ctx)) return
        try {
            val admin = ComponentName(ctx, KioskAdminReceiver::class.java)
            val d = dpm(ctx)
            d.setLockTaskPackages(admin, arrayOf(ctx.packageName))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                d.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
