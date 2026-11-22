package hu.dragtheblox

import android.content.Context
import android.net.Uri

/** A szülő által az appban beállított webes cím (a buildben megadott WEB_APP_URL az alapérték). */
object AppSettings {
    private const val PREFS = "kockavar"
    private const val KEY_URL = "web_url"

    fun webUrl(ctx: Context): String =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_URL, null)?.takeIf { it.isNotBlank() }
            ?: BuildConfig.WEB_APP_URL

    fun setWebUrl(ctx: Context, url: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_URL, url).apply()
    }

    /** A beírt címet érvényes https:// címre alakítja, vagy null, ha nem használható. */
    fun normalize(input: String): String? {
        var s = input.trim()
        if (s.isEmpty()) return null
        if (!s.contains("://")) s = "https://$s"
        val uri = Uri.parse(s)
        val host = uri.host ?: return null
        if (uri.scheme != "https" || !host.contains('.')) return null
        return uri.toString()
    }
}
