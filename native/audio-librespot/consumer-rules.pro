# JNI entry points are looked up by name from the Rust library.
-keep class com.spotifydashboard.librespot.LibrespotBridge { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}

# Capacitor discovers plugins by annotation/reflection.
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class com.spotifydashboard.librespot.LibrespotPlayerPlugin { *; }
