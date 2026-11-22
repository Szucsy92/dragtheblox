# DragTheBlox

Egy olyan térbeli játékot szeretnék ahol építőkockákat lehet egymásra tenni.

A célom egy meseszerű színes blokkok pakolása és tiltre borigatása. Ha rázom a telefont akkor valósághűen mozogjanak, ütközzenek. A teljes kijelzőn jelenjen meg úgy hogy a navigációs sáv és értesítésisáv megmarad átlátszóban (ott is látszanak a kockák ha oda repülnek vagy addig ér a torony.

Az elemeket ki lehessen választani. Amire rákattintok az be esik a térbe. Drag and drop jelleggel ujjhúzással tehetem a kockákat.
Audio/vizuális feedback lehet persze

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d5afe1c0-de5d-4c7d-94b8-25e8b0ef8172).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Android alkalmazás (teljes képernyős kiosk, aláírt APK, OTA)

A `native/android` projekt egy kiosk-védett WebView-héj, amely a Pop and Play Letters mintájára épül: aláírt Release APK
a `.github/workflows/android-build.yml`-ből, automatikus aláírókulcs (a `signing` ágon), és felugró
ablakos frissítés a GitHub Releases-ről. Beállítás és kiosk-útmutató: [`native/README.md`](native/README.md).

