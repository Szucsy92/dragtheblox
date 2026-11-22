package hu.dragtheblox

/** Szülői zár: 5 gyors koppintás 2 másodpercen belül nyitja a szülői menüt (gyerek véletlenül nem találja el). */
class ChildLockController(private val onUnlock: () -> Unit) {
    private var taps = mutableListOf<Long>()

    fun tap(now: Long = android.os.SystemClock.elapsedRealtime()) {
        taps = taps.filter { now - it <= 2_000 }.toMutableList()
        taps.add(now)
        if (taps.size >= 5) {
            taps.clear()
            onUnlock()
        }
    }
}
