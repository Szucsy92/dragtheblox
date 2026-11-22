package hu.dragtheblox

import android.app.admin.DeviceAdminReceiver

/**
 * Csak akkor van szerepe, ha az app eszköztulajdonosként (device owner) lett beállítva:
 * `adb shell dpm set-device-owner hu.dragtheblox/.KioskAdminReceiver`. Ilyenkor a rendszer
 * kérdés nélkül, valódi kiosk módban (Lock Task) indítja az appot. Lásd: native/README.md.
 */
class KioskAdminReceiver : DeviceAdminReceiver()
