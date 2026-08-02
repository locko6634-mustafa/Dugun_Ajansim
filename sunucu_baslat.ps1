# Bağımsız Sunucu Başlatıcı (Taşınabilir Sürüm)
param(
    [switch]$Wait
)

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptPath) { $scriptPath = Get-Location }
$workingDir = $scriptPath
$port = 8000

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $execPath = $nodeCommand.Source
    $cmdArgs = """$execPath"" ""$workingDir\tools\serve.mjs"" $port"
} else {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        Write-Host "Hata: Node.js veya Python sisteminizde yuklu degil!" -ForegroundColor Red
        Exit
    }
    $execPath = $pythonCommand.Source
    $cmdArgs = """$execPath"" -c ""import http.server; http.server.test(http.server.SimpleHTTPRequestHandler, http.server.ThreadingHTTPServer, port=$port)"""
}

Write-Host "Sunucu WMI ile bagimsiz olarak baslatiliyor..." -ForegroundColor Cyan
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmdArgs
    CurrentDirectory = $workingDir
}

if ($result.ReturnValue -eq 0) {
    Write-Host "Sunucu basariyla baslatildi! PID: $($result.ProcessId)" -ForegroundColor Green
    Write-Host "Proje Dizini: $workingDir" -ForegroundColor Green
    Write-Host "Tarayicinizdan http://localhost:$port adresine gidebilirsiniz." -ForegroundColor Green
    if ($Wait) {
        Write-Host "Test tamamlanana kadar sunucu sureci izleniyor..." -ForegroundColor Cyan
        Wait-Process -Id $result.ProcessId
    }
} else {
    Write-Host "Sunucu baslatilamadi. Hata Kodu: $($result.ReturnValue)" -ForegroundColor Red
    exit 1
}
