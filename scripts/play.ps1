# Starts Allerya Heroes in its own window and stops the game server when that window closes.
#
#   Play.bat      the game, from a production build: loads in a moment. Rebuilds first when the
#                 code has changed since the last build.
#   Develop.bat   the development server, with the content editor and dungeon maker. Slower to load.
#
# The server runs hidden inside WSL. The window is Edge (or Chrome) in app mode with its own profile,
# so it is a separate process the script can wait on. It opens at once on a "getting ready" page that
# moves on to the game when the server answers.

param(
  [switch]$Dev,          # development server with the editors
  [switch]$ServerOnly    # start the server and exit, for testing
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Port = if ($Dev) { 5173 } else { 4173 }
$Url = "http://127.0.0.1:$Port/"
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
  # Ends either server inside WSL; the hidden wsl.exe that hosted it then exits by itself.
  & wsl.exe -e pkill -f "vite.*--port $Port" 2>$null | Out-Null
}

# Is the production build older than the code? Then it needs rebuilding before playing.
function Test-BuildStale {
  $built = Join-Path $Root 'dist\index.html'
  if (-not (Test-Path $built)) { return $true }
  $builtAt = (Get-Item $built).LastWriteTimeUtc
  $sources = @(
    (Get-ChildItem (Join-Path $Root 'src') -Recurse -File),
    (Get-ChildItem (Join-Path $Root 'public') -Recurse -File),
    (Get-Item (Join-Path $Root 'index.html')),
    (Get-Item (Join-Path $Root 'vite.config.ts')),
    (Get-Item (Join-Path $Root 'package-lock.json'))
  ) | ForEach-Object { $_ }
  return [bool]($sources | Where-Object { $_.LastWriteTimeUtc -gt $builtAt } | Select-Object -First 1)
}

# 1. The server, hidden, unless one is already up from an earlier launch.
$building = $false
if (-not (Test-Server)) {
  if ($Dev) {
    $bash = "{ [ -d node_modules ] || npm install; } && { npm run dev -- --host 127.0.0.1 --port $Port --strictPort; } > $Log 2>&1"
  } else {
    $building = Test-BuildStale
    $build = if ($building) { 'npx vite build && ' } else { '' }
    $bash = "{ [ -d node_modules ] || npm install; } && { $build npx vite preview --host 127.0.0.1 --port $Port --strictPort; } > $Log 2>&1"
  }
  # One argument string: Start-Process does not quote list items, and the bash command has spaces.
  Start-Process -FilePath 'wsl.exe' -ArgumentList "--cd `"$Root`" -e bash -lc `"$bash`"" -WindowStyle Hidden | Out-Null
}

if ($ServerOnly) {
  for ($i = 0; $i -lt 360 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 500 }
  if (Test-Server) { "server ready on $Url" } else { 'server did not start'; exit 1 }
  exit 0
}

# 2. The game window: Edge or Chrome in app mode, with a profile of its own so it is a separate process.
$browsers = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $browsers | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

# Open straight away on the "getting ready" page; it moves on to the game when the server answers.
$launchPage = (New-Object System.Uri (Join-Path $PSScriptRoot 'launch.html')).AbsoluteUri
$query = "?url=$([uri]::EscapeDataString($Url))" + $(if ($building) { '&building=1' } else { '' })

if ($browser) {
  $window = Start-Process -FilePath $browser -PassThru -ArgumentList @(
    "--app=`"$launchPage$query`"",
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
  # No Edge or Chrome: wait for the server, use the default browser, and stop when the player says so.
  for ($i = 0; $i -lt 360 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Server)) {
    Stop-Server
    Show-Error "The game server did not start. To see why, run this in a terminal:`n`nwsl cat $Log"
    exit 1
  }
  Start-Process $Url
  [System.Windows.MessageBox]::Show('The game is open in your browser. Click OK when you have finished playing to stop the game server.', 'Allerya Heroes') | Out-Null
}

# 3. The game is closed: stop the server.
Stop-Server
