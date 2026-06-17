# ── ProGuard Rules for Factory Control App ──

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase

# ZXing
-keep class com.google.zxing.** { *; }
-keep class com.journeyapps.barcodescanner.** { *; }

# Keep Accessibility Service (system callback)
-keep class com.factory.control.SetupAutomationService { *; }

# Keep Device Admin Receiver (system callback)
-keep class com.factory.control.AdminReceiver { *; }

# Keep Boot Receiver (system callback)
-keep class com.factory.control.BootReceiver { *; }

# Keep ControlService (foreground service)
-keep class com.factory.control.ControlService { *; }

# Keep MainActivity (activity entry)
-keep class com.factory.control.MainActivity { *; }

# Keep Application class
-keep class com.factory.control.App { *; }

# AndroidX
-keep class androidx.** { *; }
-keep interface androidx.** { *; }

# Material Design
-keep class com.google.android.material.** { *; }

# Kotlin metadata (preserve for reflection)
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**

# Remove debug logging in release
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
}
