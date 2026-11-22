# Kockavár – Android (kiosk, aláírt APK, OTA)

A `native/android` egy kis Kotlin **WebView-héj** a webes játék köré, a Pop and Play Letters alkalmazással azonos
felépítésben: teljes képernyő, kiosk-védelem, aláírt Release APK GitHub Actionsből és felugró ablakos frissítés
a GitHub Releases-ről.

## Mit tud az alkalmazás

- **Teljes képernyő:** immersive sticky mód, ébren tartott képernyő, vágás (notch) alá is kitölt, a Vissza gomb nem lép ki.
- **Kiosk-védelem:**
  - képernyőrögzítés (`startLockTask`), minden visszatéréskor újra rögzít;
  - **eszköztulajdonosként valódi kiosk** (nincs rendszerkérdés, Home/Recents/állapotsor tiltva), lásd lent;
  - csak a játék saját címe tölthető be, külső link nem nyílik meg;
  - nincs hosszú-érintés menü, nincs nagyítás, a rendszer betűmérete nem törik a játékot;
  - ha a WebView folyamata összeomlik, az app új WebView-t épít (nem fagy ki).
- **Szülői menü:** 5 gyors koppintás 2 másodpercen belül a **jobb felső sarokban** (72 dp-s láthatatlan felület):
  Vissza a játékhoz / Frissítés keresése / **Játék címe** / Kilépés (megerősítéssel).
- **OTA frissítés (felugró ablak):** indításkor az app megnézi a GitHub `releases/latest` kiadását. Ha a címke végi
  futásszám nagyobb a telepített `versionCode`-nál, megjelenik az **„Új frissítés elérhető 🎉”** ablak
  (**Később** / **Letöltés**, haladásjelzővel). A Letöltés az APK-t az appon belül letölti, majd elindítja a telepítést
  (a rendszer egyszer az „ismeretlen forrásból telepítés” engedélyt és a telepítés jóváhagyását kéri).
- **Offline oldal:** ha nincs kapcsolat, barátságos „Újra” oldal látszik, és a hálózat visszatértekor a játék magától betöltődik.

## Beállítás (egyszer)

1. **Webes cím (kétféleképpen, bármelyik elég):**
   - **az appban:** első indításkor az app magától rákérdez a játék HTTPS címére (később: Szülői menü → *Játék címe*);
     a cím az eszközön megmarad, nem kell újraépíteni az APK-t;
   - **a buildben:** Settings → Secrets and variables → Actions → **Variables** → `WEB_APP_URL` = a kiadott játék
     HTTPS címe (pl. a Lovable *Publish* után kapott cím). Ez az alapérték, amit az app-beli beállítás felülírhat.
   *Opcionális, offline:* `BUNDLE_WEB` = `true`: a workflow megpróbálja statikus csomagként (`NATIVE_BUILD=1`,
   TanStack Start SPA mód) beágyazni a játékot az APK-ba. Ha ez nem sikerül, a build a `WEB_APP_URL` címre esik vissza.
2. **Aláírókulcs: nincs teendő, kézi titok sem kell.** Az első build maga generál egy RSA-4096 kulcsot, és
   titkosítva (AES-256-CBC/PBKDF2) a jelszavával együtt a `signing` ágra menti a beépített `GITHUB_TOKEN`-nel; a későbbi
   build-ek onnan töltik vissza. **A `signing` ágat ne töröld és ne írd felül:** a telepített app csak ugyanazzal a kulccsal
   aláírt APK-ra frissülhet. *Figyelem:* a jelszó is a `signing` ágon van, a kulcs védelme tehát a tároló hozzáférési jogain
   múlik. Nyilvános tárolóban az ág is olvasható (a frissítéshez a kiadásoknak nyilvánosnak kell lenniük), ezért a kulcs
   nem tekinthető titoknak: a telepített app védelmét a kiadások feletti írási jog adja.
3. **Build:** Actions → **Android APK (aláírt, kiosk)** → *Run workflow* (vagy `native/**` módosítása `main`-en).
   Eredmény: GitHub Release `native-<dátum>-<futásszám>` címkével és `kockavar-<dátum>.apk` melléklettel.
   Minden kiadás aláírt (a build `apksigner`-rel ellenőrzi).
   A repónak **nyilvánosnak** kell lennie, hogy az app hitelesítés nélkül lássa a kiadást.

## Valódi kiosk (eszköztulajdonos)

Képernyőrögzítés is védi az appot, de a gyerek a Vissza + Áttekintés gombokkal kiléphet belőle. Teljes zárhoz egyszer
állítsd be az appot eszköztulajdonosnak (a telefon gyári beállítása után, még **Google-fiók nélkül**):

```
adb shell dpm set-device-owner hu.dragtheblox/.KioskAdminReceiver
```

Ezután az app kérdés nélkül Lock Task módban indul, a rendszergombok és az állapotsor tiltva vannak. A szülői menüből
a Kilépés feloldja. Eltávolítás: `adb shell dpm remove-active-admin hu.dragtheblox/.KioskAdminReceiver`.

## Helyi fejlesztés

Android Studio (Ladybug / Koala vagy újabb): nyisd meg a `native/android` mappát. Helyi build: a `WEB_APP_URL`
környezeti változóval adható meg a webes cím; a `GITHUB_REPOSITORY` nélkül a frissítés-ellenőrzés ki van kapcsolva.

## Korlátok

- A kiosk és a képernyőrögzítés OS-szintű korlátozásoktól függ; eszköztulajdonos nélkül nem garantálható minden gyártónál.
- A frissítéshez a kiadásoknak **ugyanazzal a kulccsal** kell aláírva lenniük (aláíratlan vagy más kulcsú APK nem frissíthet).
- iOS-hez nincs natív változat (a Pop and Play Letters SwiftUI részét itt nem másoltuk).
