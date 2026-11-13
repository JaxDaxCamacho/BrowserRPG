# Starts Allerya Heroes in its own window and stops the game server when that window closes.
# Run through Play.bat. The server runs hidden inside WSL; the game opens as an Edge (or Chrome)
# app window with its own profile, so closing the window ends the game and then the server.

param([switch]$ServerOnly)   # -ServerOnly: start the server and exit, for testing

$ErrorActionPreference = 'Stop'
$Url = 'http://127.0.0.1:5173'
$Root = Split-Path -Parent $PSScriptRoot
$WindowProfile = Join-Path $env:LOCALAPPDATA 'AlleryaHeroes\window'
# Inside WSL, so the path needs no translating or quoting.
$Log = '/tmp/allerya-server.log'

Add-Type -AssemblyName PresentationFramework
function Show-Error([string]$Text) {
  [System.Windows.MessageBox]::Show($Text, 'Allerya Heroes', 'OK', 'Error') | Out-Null
}

function Test-Server {
  try { Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

function Stop-Server {
  # Ends the dev server inside WSL; the hidden wsl.exe that hosted it then exits by itself.
  & wsl.exe -e pkill -f 'vite --host 127.0.0.1 --port 5173' 2>$null | Out-Null
}

# 1. The server, hidden, unless one is already up from an earlier launch.
if (-not (Test-Server)) {
  # One argument string: Start-Process does not quote list items, and the bash command has spaces.
  $bash = "{ [ -d node_modules ] || npm install; } && npm run dev -- --host 127.0.0.1 --port 5173 --strictPort > $Log 2>&1"
  Start-Process -FilePath 'wsl.exe' -ArgumentList "--cd `"$Root`" -e bash -lc `"$bash`"" -WindowStyle Hidden | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 360; $i++) {   # up to 3 minutes: the first run installs packages
    if (Test-Server) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    Stop-Server
    Show-Error "The game server did not start. To see why, run this in a terminal:`n`nwsl cat $Log"
    exit 1
  }
}
if ($ServerOnly) { 'server ready'; exit 0 }

# 2. The game window: Edge or Chrome in app mode, with a profile of its own so it is a separate process.
$browsers = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $browsers | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if ($browser) {
  $window = Start-Process -FilePath $browser -PassThru -ArgumentList @(
    "--app=$Url",
    "--user-data-dir=`"$WindowProfile`"",
    '--window-size=1366,850',
    '--no-first-run',
    '--no-default-browser-check'
  )
  $window.WaitForExit()
  # The window may hand over to helper processes; wait until nothing uses the game's profile.
  do {
    Start-Sleep -Milliseconds 500
    $left = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe' OR Name = 'chrome.exe'" |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($WindowProfile) }
  } while ($left)
} else {
  # No Edge or Chrome: use the default browser, and stop the server when the player says so.
  Start-Process $Url
  [System.Windows.MessageBox]::Show('The game is open in your browser. Click OK when you have finished playing to stop the game server.', 'Allerya Heroes') | Out-Null
}

# 3. The game is closed: stop the server.
Stop-Server
