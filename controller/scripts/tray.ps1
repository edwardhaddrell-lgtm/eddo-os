# Tray icon for the Loupedeck controller. Started by src/tray.ts.
# Menu clicks are written to stdout as one-word commands; status text is read
# from a JSON file the app keeps updated. Exits when the parent process ends.
param(
    [Parameter(Mandatory)][string]$IconFile,
    [Parameter(Mandatory)][string]$StatusFile,
    [Parameter(Mandatory)][int]$ParentPid
)

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$bitmap = [System.Drawing.Bitmap]::FromFile($IconFile)
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icon
$tray.Text = 'Loupedeck: starting'
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusDevice = $menu.Items.Add('Deck: starting')
$statusDevice.Enabled = $false
$statusHa = $menu.Items.Add('Home Assistant: starting')
$statusHa.Enabled = $false
[void]$menu.Items.Add('-')

function Add-Command([string]$text, [string]$command) {
    $item = $menu.Items.Add($text)
    $item.add_Click({ [Console]::Out.WriteLine($command); [Console]::Out.Flush() }.GetNewClosure())
}
Add-Command 'Reload config' 'reload'
Add-Command 'Open deck.yaml' 'config'
Add-Command 'Open log' 'log'
[void]$menu.Items.Add('-')
Add-Command 'Restart' 'restart'
Add-Command 'Quit' 'quit'
$tray.ContextMenuStrip = $menu

# Left-click opens the menu too
$tray.add_MouseClick({
    param($s, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        $m = [System.Windows.Forms.NotifyIcon].GetMethod('ShowContextMenu', [System.Reflection.BindingFlags]'Instance,NonPublic')
        $m.Invoke($tray, $null)
    }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({
    if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
        $tray.Visible = $false
        [System.Windows.Forms.Application]::Exit()
        return
    }
    try {
        $s = Get-Content -Raw -Path $StatusFile -ErrorAction Stop | ConvertFrom-Json
        $statusDevice.Text = "Deck: $($s.device)"
        $statusHa.Text = "Home Assistant: $($s.ha)"
        $text = "Loupedeck: $($s.device), HA $($s.ha)"
        if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
        $tray.Text = $text
    } catch {}
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
$tray.Visible = $false
$tray.Dispose()
