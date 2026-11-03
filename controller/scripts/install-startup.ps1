# Creates (or with -Remove, deletes) two shortcuts that run the Loupedeck
# controller in the background. No admin rights needed.
#   Startup folder: starts it at login
#   Start menu:     start it by hand (does nothing if it's already running)
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1 -Remove
param([switch]$Remove)

$root = Split-Path -Parent $PSScriptRoot
$links = @(
    (Join-Path ([Environment]::GetFolderPath('Startup')) 'Loupedeck Controller.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'Loupedeck Controller.lnk')
)

if ($Remove) {
    foreach ($link in $links) {
        Remove-Item $link -ErrorAction SilentlyContinue
        "Removed $link"
    }
    return
}

$shell = New-Object -ComObject WScript.Shell
foreach ($link in $links) {
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = (Get-Command powershell.exe).Source
    $shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\run.ps1`""
    $shortcut.WorkingDirectory = $root
    $shortcut.WindowStyle = 7  # minimised, so nothing flashes up
    $shortcut.IconLocation = "$root\assets\app.ico,0"
    $shortcut.Description = 'Loupedeck Live controller'
    $shortcut.Save()
    "Created $link"
}
