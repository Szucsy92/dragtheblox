# Kockavár – Android (offline, kiosk, aláírt APK, OTA)

A `native/android` egy kis Kotlin héj, amelybe a **játék teljesen be van csomagolva**: a játékhoz nincs szükség
internetre, és nincs webes cím sem. Teljes képernyő, kiosk-védelem, aláírt Release APK GitHub Actionsből és
felugró ablakos frissítés a GitHub Releases-ről (ez az egyetlen, nem kötelező hálózati használat).

## Hogyan készül az offline játék

- `native-web/` + `vite.native.config.ts`: a játék (a `Playroom` komponens) önálló, SSR és router nélküli buildje
  (`bun run build:native` → `dist-native/`). A hosztolt oldal továbbra is a `vite.config.ts`-ből épül.
- A workflow ezt másolja az APK `assets/www` mappájába; az app a saját, `appassets.androidplatform.net` forrásból
  szolgálja ki. **Minden külső kérés tiltva van** (betűtípus, CDN, analitika), a külső linkek nem nyílnak meg.
- A `Baloo 2` betűtípus offline nem érhető el, a feliratok rendszerbetűvel jelennek meg.

> Ez ugyanaz a játékmotor (three.js + Rapier), WebView-ban futtatva, nem Kotlin/OpenGL újraírás.

## Mit tud az alkalmazás

- **Teljes képernyő:** immersive sticky mód, ébren tartott képernyő, vágás (notch) alá is kitölt, a Vissza gomb nem lép ki.
- **Kiosk-védelem:**
  - képernyőrögzítés (`startLockTask`), minden visszatéréskor újra rögzít;
  - **eszköztulajdonosként valódi kiosk** (nincs rendszerkérdés, Home/Recents/állapotsor tiltva), lásd lent;
  - nincs hosszú-érintés menü, nincs nagyítás, a rendszer betűmérete nem törik a játékot;
  - ha a WebView folyamata összeomlik, az app új WebView-t épít (nem fagy ki).
- **Szülői menü:** 5 gyors koppintás 2 másodpercen belül a **jobb felső sarokban** (72 dp-s láthatatlan felület):
  Vissza a játékhoz / Frissítés keresése / Kilépés (megerősítéssel).
- **OTA frissítés (felugró ablak):** indításkor az app megnézi a GitHub `releases/latest` kiadását (ha nincs hálózat,
  csendben kihagyja). Ha a címke végi futásszám nagyobb a telepített `versionCode`-nál, megjelenik az
  **„Új frissítés elérhető 🎉”** ablak (**Később** / **Letöltés**, haladásjelzővel). A Letöltés az APK-t az appon belül
  letölti, majd elindítja a telepítést (a rendszer egyszer az „ismeretlen forrásból telepítés” engedélyt és a
  telepítés jóváhagyását kéri).

## Build és kiadás

1. **Aláírókulcs: nincs teendő, kézi titok sem kell.** Az első build maga generál egy RSA-4096 kulcsot, és
   titkosítva (AES-256-CBC/PBKDF2) a jelszavával együtt a `signing` ágra menti a beépített `GITHUB_TOKEN`-nel; a későbbi
   build-ek onnan töltik vissza. **A `signing` ágat ne töröld és ne írd felül:** a telepített app csak ugyanazzal a kulccsal
   aláírt APK-ra frissülhet. *Figyelem:* a jelszó is a `signing` ágon van, a kulcs védelme tehát a tároló hozzáférési jogain
   múlik. Nyilvános tárolóban az ág is olvasható (a frissítéshez a kiadásoknak nyilvánosnak kell lenniük), ezért a kulcs
   nem tekinthető titoknak: a telepített app védelmét a kiadások feletti írási jog adja.
2. **Build:** Actions → **Android APK (aláírt, kiosk)** → *Run workflow*. Automatikusan indul, ha a `native/**`,
   a `native-web/**` vagy a `vite.native.config.ts` változik `main`-en. **A játék módosítása (`src/**`) nem indítja
   magától**, hogy ne készüljön kiadás minden szerkesztésre; változtatás után futtasd kézzel.
   Eredmény: GitHub Release `native-<dátum>-<futásszám>` címkével és `kockavar-<dátum>.apk` melléklettel,
   minden kiadás aláírt (a build `apksigner`-rel ellenőrzi). A repónak **nyilvánosnak** kell lennie, hogy az app
   hitelesítés nélkül lássa a kiadást.

## Valódi kiosk (eszköztulajdonos)

Képernyőrögzítés is védi az appot, de a gyerek a Vissza + Áttekintés gombokkal kiléphet belőle. Teljes zárhoz egyszer
állítsd be az appot eszköztulajdonosnak (a telefon gyári beállítása után, még **Google-fiók nélkül**):

```
adb shell dpm set-device-owner hu.dragtheblox/.KioskAdminReceiver
```

Ezután az app kérdés nélkül Lock Task módban indul, a rendszergombok és az állapotsor tiltva vannak. A szülői menüből
a Kilépés feloldja. Eltávolítás: `adb shell dpm remove-active-admin hu.dragtheblox/.KioskAdminReceiver`.

## Helyi fejlesztés

Android Studio (Ladybug / Koala vagy újabb): futtasd `bun run build:native`, másold a `dist-native/` tartalmát a
`native/android/app/src/main/assets/www/` mappába, majd nyisd meg a `native/android` mappát. A `GITHUB_REPOSITORY` nélkül
a frissítés-ellenőrzés ki van kapcsolva; `assets/www` nélkül az app egy „a játékcsomag hiányzik” oldalt mutat.

## Korlátok

- A kiosk és a képernyőrögzítés OS-szintű korlátozásoktól függ; eszköztulajdonos nélkül nem garantálható minden gyártónál.
- A frissítéshez a kiadásoknak **ugyanazzal a kulccsal** kell aláírva lenniük.
- iOS-hez nincs natív változat.
