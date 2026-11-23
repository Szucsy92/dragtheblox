package hu.dragtheblox

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.Dialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import kotlinx.coroutines.launch
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException

private const val ASSET_HOST = "appassets.androidplatform.net"
private val BACKGROUND = 0xFF0E1222.toInt()

/**
 * Kockavár: teljesen offline, teljes képernyős, kiosk-védett játék. A játék az APK-ba van csomagolva (assets/www),
 * a WebView csak ezt a saját forrást tölti be, minden külső kérés le van tiltva: a játékhoz nem kell internet.
 *  - immersive sticky mód, ébren tartott képernyő, letiltott Vissza gomb;
 *  - képernyőrögzítés (Lock Task), eszköztulajdonosként valódi kiosk;
 *  - szülői menü: 5 gyors koppintás a jobb felső sarokban;
 *  - az egyetlen hálózati használat a (nem kötelező) frissítés-ellenőrzés a GitHub Releases-ről, felugró ablakkal.
 */
class MainActivity : ComponentActivity() {
    private lateinit var root: FrameLayout
    private var web: WebView? = null
    private var pendingApk: File? = null
    private var updateDialog: Dialog? = null
    private var updateChecked = false
    private val lock = ChildLockController { runOnUiThread { showParentMenu() } }

    /** A játék a CI-ben beágyazott webes csomagból fut (assets/www). */
    private val bundled: Boolean by lazy {
        try { assets.list("www")?.contains("index.html") == true } catch (_: IOException) { false }
    }

    private val assetLoader: WebViewAssetLoader by lazy {
        WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .addPathHandler("/", WebViewAssetLoader.PathHandler { path -> serveBundled(path) })
            .build()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        root = FrameLayout(this).apply { setBackgroundColor(BACKGROUND) }
        setContentView(root)
        attachWebView()
        addLockZone()
        // A Vissza gomb nem léphet ki a játékból: kiosk.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {}
        })
        hideSystemBars()
        Kiosk.prepare(this)
        pinApp()
        loadApp()
        if (!updateChecked) {
            updateChecked = true
            checkForUpdate(manual = false)
        }
    }

    // ---- Teljes képernyő és kiosk ----

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() = immersive(window)

    private fun immersive(w: Window) {
        val controller = WindowCompat.getInsetsController(w, w.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    fun pinApp() {
        try { startLockTask() } catch (e: Exception) { e.printStackTrace() }
    }

    fun unpinApp() {
        try { stopLockTask() } catch (e: Exception) { e.printStackTrace() }
    }

    override fun onResume() {
        super.onResume()
        web?.onResume()
        val f = pendingApk
        if (f != null) {
            pendingApk = null
            if (packageManager.canRequestPackageInstalls()) { installApk(f); return }
        }
        pinApp() // visszatérés a beállításokból / a telepítőből: újra rögzítve
    }

    override fun onPause() {
        web?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        web?.let { root.removeView(it); it.destroy() }
        web = null
        super.onDestroy()
    }

    // ---- WebView ----

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView = WebView(this).apply {
        setBackgroundColor(BACKGROUND)
        overScrollMode = View.OVER_SCROLL_NEVER
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        isLongClickable = false
        setOnLongClickListener { true }
        isHapticFeedbackEnabled = false
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            textZoom = 100 // a rendszer betűmérete ne törje szét a játék elrendezését
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
        }
        webViewClient = Client()
    }

    private fun attachWebView() {
        val w = createWebView()
        web = w
        root.addView(w, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    private fun rebuildWebView() {
        web?.let { root.removeView(it); it.destroy() }
        attachWebView()
        loadApp()
    }

    private fun loadApp() {
        val w = web ?: return
        if (bundled) w.loadUrl("https://$ASSET_HOST/") else showMissing()
    }

    /** Csak akkor látszik, ha a build elromlott és nem került csomag az APK-ba. */
    private fun showMissing() {
        val html = try {
            assets.open("missing.html").bufferedReader().use { it.readText() }
        } catch (_: IOException) {
            "<html><body style='background:#0e1222;color:#fff'><p>A játékcsomag hiányzik.</p></body></html>"
        }
        web?.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
    }

    private inner class Client : WebViewClient() {
        // Kiosk és offline: kizárólag az app saját forrása nyitható meg, külső linkre nem lehet kilépni.
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            request.url.host != ASSET_HOST

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            if (request.url.host == ASSET_HOST) {
                assetLoader.shouldInterceptRequest(request.url)
            } else {
                // Minden külső kérés (betűtípus, analitika, bármi) tiltva: a játék teljesen offline.
                WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            }

        // A WebView folyamata összeomlott vagy a rendszer leállította: új WebView, nem fagy ki a játék.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            runOnUiThread { rebuildWebView() }
            return true
        }
    }

    /** A beágyazott játék kiszolgálása; az ismeretlen (kiterjesztés nélküli) útvonalak az index.html-re esnek vissza (SPA). */
    private fun serveBundled(path: String): WebResourceResponse? {
        val rel = path.trimStart('/').ifEmpty { "index.html" }
        val candidates = mutableListOf("www/$rel")
        if (!rel.substringAfterLast('/').contains('.')) candidates.add("www/index.html")
        for (c in candidates) {
            try {
                val mime = mimeOf(c)
                val enc = if (mime.startsWith("text/") || mime == "application/json") "UTF-8" else null
                return WebResourceResponse(mime, enc, assets.open(c))
            } catch (_: IOException) {
                // próbáljuk a következőt
            }
        }
        // Hiányzó fájl: tiszta 404 (a null a WebView-t a nem létező domainre küldené).
        return WebResourceResponse("text/plain", "UTF-8", 404, "Not found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }

    private fun mimeOf(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json", "map" -> "application/json"
        "webmanifest" -> "application/manifest+json"
        "wasm" -> "application/wasm"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "ico" -> "image/x-icon"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        "ttf" -> "font/ttf"
        "mp3" -> "audio/mpeg"
        "ogg" -> "audio/ogg"
        "wav" -> "audio/wav"
        else -> "application/octet-stream"
    }

    // ---- Szülői zár és menü ----

    /** Átlátszó, 72 dp-s érintőfelület a jobb felső sarokban: 5 gyors koppintás nyitja a szülői menüt. */
    private fun addLockZone() {
        val size = (72 * resources.displayMetrics.density).toInt()
        val zone = View(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isHapticFeedbackEnabled = false
            setOnClickListener { lock.tap() }
        }
        root.addView(zone, FrameLayout.LayoutParams(size, size, Gravity.TOP or Gravity.END))
    }

    private fun showParentMenu() {
        if (updateDialog?.isShowing == true) return
        val items = arrayOf("Vissza a játékhoz", "Frissítés keresése", "Kilépés")
        val d = AlertDialog.Builder(this)
            .setTitle("Szülői menü · ${BuildConfig.VERSION_NAME}")
            .setItems(items) { _, which ->
                when (which) {
                    1 -> checkForUpdate(manual = true)
                    2 -> confirmExit()
                }
            }
            .setOnDismissListener { hideSystemBars() }
            .create()
        d.setOnShowListener { d.window?.let { immersive(it) } }
        d.show()
    }

    private fun confirmExit() {
        val d = AlertDialog.Builder(this)
            .setTitle("Kilépés")
            .setMessage("Biztosan kilépsz a játékból?")
            .setPositiveButton("Kilépés") { _, _ ->
                unpinApp()
                finishAndRemoveTask()
            }
            .setNegativeButton("Mégsem", null)
            .setOnDismissListener { hideSystemBars() }
            .create()
        d.setOnShowListener { d.window?.let { immersive(it) } }
        d.show()
    }

    // ---- Frissítés (felugró ablak) ----

    private fun checkForUpdate(manual: Boolean) {
        lifecycleScope.launch {
            val info = UpdateManager.check(this@MainActivity)
            if (info != null) {
                showUpdateDialog(info)
            } else if (manual) {
                Toast.makeText(this@MainActivity, "Nincs újabb verzió.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showUpdateDialog(info: UpdateInfo) {
        if (updateDialog?.isShowing == true) return
        val pad = (20 * resources.displayMetrics.density).toInt()
        val status = TextView(this).apply { textSize = 16f; text = info.versionName }
        val bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
        }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad / 2, pad, 0)
            addView(status)
            addView(bar)
        }
        val d = AlertDialog.Builder(this)
            .setTitle("Új frissítés elérhető 🎉")
            .setView(box)
            .setPositiveButton("Letöltés", null)
            .setNegativeButton("Később", null)
            .setCancelable(false)
            .create()
        var ready: File? = null
        d.setOnShowListener {
            val ok = d.getButton(AlertDialog.BUTTON_POSITIVE)
            val later = d.getButton(AlertDialog.BUTTON_NEGATIVE)
            ok.setOnClickListener {
                val f = ready
                if (f != null && f.exists()) { installApk(f); return@setOnClickListener }
                ok.isEnabled = false
                later.isEnabled = false
                bar.progress = 0
                bar.visibility = View.VISIBLE
                status.text = "Letöltés… 0%"
                lifecycleScope.launch {
                    try {
                        val file = UpdateManager.download(this@MainActivity, info) { p ->
                            runOnUiThread { bar.progress = p; status.text = "Letöltés… $p%" }
                        }
                        ready = file
                        bar.visibility = View.GONE
                        status.text = "A telepítés elindult. Hagyd jóvá a megjelenő ablakban."
                        ok.text = "Telepítés újra"
                        ok.isEnabled = true
                        later.isEnabled = true
                        installApk(file)
                    } catch (e: Exception) {
                        bar.visibility = View.GONE
                        status.text = "Nem sikerült letölteni. Próbáld újra!"
                        ok.isEnabled = true
                        later.isEnabled = true
                    }
                }
            }
            later.setOnClickListener { d.dismiss() }
            d.window?.let { immersive(it) }
        }
        d.setOnDismissListener { updateDialog = null; hideSystemBars() }
        updateDialog = d
        d.show()
    }

    /** A letöltött frissítés telepítése. Kell hozzá az "ismeretlen forrás" engedély; a rendszer telepítője egy jóváhagyást kér. */
    private fun installApk(file: File) {
        unpinApp() // a képernyőrögzítés (lock task) blokkolná a telepítő / beállítások ablakát
        if (!packageManager.canRequestPackageInstalls()) {
            pendingApk = file
            try {
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            } catch (e: Exception) {
                e.printStackTrace()
            }
            return
        }
        try {
            val uri = FileProvider.getUriForFile(this, "$packageName.update", file)
            startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
            )
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
