# Runs the Loupedeck controller in the background and restarts it if it crashes
# or a restart is requested from the tray. Started at login by the Startup
# folder shortcut (see scripts/install-startup.ps1).
#   exit 0  = quit from tray  -> stop
#   exit 3  = already running -> stop
#   exit 75 = restart         -> start again now
#   other   = crash           -> start again after a pause

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force logs | Out-Null

$crashes = @()
while ($true) {
    & node node_modules/tsx/dist/cli.mjs src/main.ts 2>&1 | Out-File -Append -Encoding utf8 logs/service.log
    $code = $LASTEXITCODE
    if ($code -eq 0 -or $code -eq 3) { break }
    if ($code -eq 75) { continue }

    # Crash: back off if it keeps happening
    $now = Get-Date
    $crashes = @($crashes | Where-Object { ($now - $_).TotalSeconds -lt 120 }) + $now
    Add-Content -Encoding utf8 logs/service.log "$(Get-Date -Format o)  Exited with code $code; restarting."
    if ($crashes.Count -ge 5) { Start-Sleep -Seconds 60 } else { Start-Sleep -Seconds 3 }
}
