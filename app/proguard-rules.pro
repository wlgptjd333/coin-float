# The chart page calls these through window.AndroidBridge; the names must survive shrinking.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes *Annotation*

# Credential Manager finds its Play services provider by name.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** {
    *;
}

# Readable crash reports.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
