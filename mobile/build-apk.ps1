# build-apk.ps1 — Build a standalone release APK locally (no Expo/EAS cloud).
#
# Usage (from the mobile/ folder):
#   powershell -ExecutionPolicy Bypass -File .\build-apk.ps1
#   powershell -ExecutionPolicy Bypass -File .\build-apk.ps1 -Clean   # wipe native build first
#   npm run apk                                                       # shortcut
#
# Produces: mobile\apk-output\orange-one.apk  (installable on any arm64 phone)

param(
    [switch]$Clean  # regenerate android/ from app.json (needed after adding native modules / SDK bumps)
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# --- Toolchain env (Android Studio's bundled JDK + your Android SDK) ---
$env:JAVA_HOME    = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
if (-not (Test-Path $env:JAVA_HOME))    { throw "JAVA_HOME not found: $env:JAVA_HOME (is Android Studio installed there?)" }
if (-not (Test-Path $env:ANDROID_HOME)) { throw "Android SDK not found: $env:ANDROID_HOME" }

# --- Regenerate native project from app.json if asked (or if android/ is missing) ---
if ($Clean -or -not (Test-Path (Join-Path $root 'android'))) {
    Write-Host "==> expo prebuild (regenerating android/ from app.json)..." -ForegroundColor Cyan
    Push-Location $root
    npx expo prebuild --platform android --clean
    Pop-Location
    # Re-apply the arm64-only + SDK path settings that a clean prebuild resets:
    $gp = Join-Path $root 'android\gradle.properties'
    (Get-Content $gp) -replace 'reactNativeArchitectures=.*', 'reactNativeArchitectures=arm64-v8a' | Set-Content $gp -Encoding utf8
    $lp = Join-Path $root 'android\local.properties'
    "sdk.dir=$($env:ANDROID_HOME -replace '\\','\\')" | Set-Content $lp -Encoding utf8
}

# --- Build ---
Write-Host "==> gradlew assembleRelease..." -ForegroundColor Cyan
Push-Location (Join-Path $root 'android')
try {
    & .\gradlew.bat assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

# --- Collect the APK ---
$apk = Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $apk)) { throw "Build reported success but APK not found at $apk" }
$outDir = Join-Path $root 'apk-output'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$dest = Join-Path $outDir 'orange-one.apk'
Copy-Item $apk $dest -Force

$sizeMB = [math]::Round((Get-Item $dest).Length / 1MB, 1)
Write-Host ""
Write-Host "BUILD OK  ->  $dest  ($sizeMB MB)" -ForegroundColor Green
Write-Host "Install on a connected phone with:  adb install -r `"$dest`"" -ForegroundColor Green
