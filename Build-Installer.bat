@echo off
rem Builds the Windows installer for Allerya Heroes (src-tauri\target\release\bundle\nsis\).
rem Needs, on Windows: Rust (https://rustup.rs) and the Visual Studio C++ Build Tools.
rem The game itself is built inside WSL, like Play.bat runs it.
title Building the Allerya Heroes installer
cd /d "%~dp0"

rem A fresh Rust install is not on the PATH of windows opened before it (Explorer keeps its old PATH),
rem so look in Rust's default folder too.
if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where cargo >/dev/null 2>nul
if errorlevel 1 (
  echo Rust is not installed on Windows.
  echo Install it from https://rustup.rs ^(choose the default options^), and the
  echo "Desktop development with C++" workload from the Visual Studio Build Tools:
  echo   https://visualstudio.microsoft.com/visual-cpp-build-tools/
  echo Then run this again.
  pause
  exit /b 1
)

cargo tauri --version >/dev/null 2>nul
if errorlevel 1 (
  echo Installing the Tauri command line tools. This happens once and takes a few minutes...
  cargo install tauri-cli --version "^2" --locked
  if errorlevel 1 ( pause & exit /b 1 )
)

echo.
echo 1/2  Building the game and bundling its art and sound...
wsl.exe --cd "%~dp0." bash -lc "npm run build:app"
if errorlevel 1 (
  echo The game build failed. See the messages above.
  pause
  exit /b 1
)

echo.
echo 2/2  Building the Windows app and installer. The first time takes several minutes...
cargo tauri build
if errorlevel 1 (
  echo The installer build failed. See the messages above.
  pause
  exit /b 1
)

echo.
echo Done. The installer is in src-tauri\target\release\bundle\nsis\
explorer "src-tauri\target\release\bundle\nsis"
pause
