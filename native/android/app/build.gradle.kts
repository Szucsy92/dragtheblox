plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "hu.dragtheblox"
    compileSdk = 35
    defaultConfig {
        applicationId = "hu.dragtheblox"
        minSdk = 26
        targetSdk = 35
        // A CI felülírja a verziót (APP_VERSION_CODE / APP_VERSION_NAME); helyben marad az alapérték.
        versionCode = System.getenv("APP_VERSION_CODE")?.toIntOrNull() ?: 1
        versionName = System.getenv("APP_VERSION_NAME") ?: "1.0.0"
        // A frissítés-ellenőrzés a CI-ban a GITHUB_REPOSITORY (tulajdonos/repó) alapján keres; helyi buildnél üres = kikapcsolva.
        val updateRepo = System.getenv("GITHUB_REPOSITORY") ?: ""
        buildConfigField("String", "UPDATE_REPO", "\"$updateRepo\"")
    }
    // Aláírás csak akkor, ha a CI megadja a kulcstárat (környezeti változókból, soha nem a forrásból).
    val keystorePath = System.getenv("ANDROID_KEYSTORE_FILE")
    signingConfigs {
        if (!keystorePath.isNullOrBlank()) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")?.takeIf { it.isNotBlank() } ?: "dragtheblox"
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            signingConfigs.findByName("release")?.let { signingConfig = it }
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
    }
    lint {
        // A release-építés ne akadjon el lint-figyelmeztetéseken (a forrást a CI külön ellenőrzi).
        abortOnError = false
        checkReleaseBuilds = false
    }
}
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}
dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
