# Bağımsız Sunucu Başlatıcı (Frontend + Backend)
param(
    [switch]$Wait
)

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptPath) { $scriptPath = Get-Location }
$frontendDir = $scriptPath
$backendDir = Join-Path $scriptPath "backend"
$frontendPort = 8000
$backendPort = 5000

# --- 1. FRONTEND SUNUCUSU ---
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $execPath = $nodeCommand.Source
    $frontendCmd = """$execPath"" ""$frontendDir\tools\serve.mjs"" $frontendPort"
} else {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        Write-Host "Hata: Node.js veya Python sisteminizde yuklu degil!" -ForegroundColor Red
        Exit 1
    }
    $execPath = $pythonCommand.Source
    $frontendCmd = """$execPath"" -c ""import http.server; http.server.test(http.server.SimpleHTTPRequestHandler, http.server.ThreadingHTTPServer, port=$frontendPort)"""
}

Write-Host "Frontend sunucusu (Port $frontendPort) WMI ile baslatiliyor..." -ForegroundColor Cyan
$feResult = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $frontendCmd
    CurrentDirectory = $frontendDir
}

if ($feResult.ReturnValue -eq 0) {
    Write-Host "-> Frontend basariyla baslatildi! PID: $($feResult.ProcessId)" -ForegroundColor Green
    Write-Host "   URL: http://localhost:$frontendPort" -ForegroundColor Green
} else {
    Write-Host "Hata: Frontend sunucusu baslatilamadi. Hata Kodu: $($feResult.ReturnValue)" -ForegroundColor Red
}

# --- 2. BACKEND SUNUCUSU ---
if (Test-Path $backendDir) {
    Write-Host "Backend dev sunucusu (Port $backendPort) WMI ile baslatiliyor..." -ForegroundColor Cyan
    $backendCmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Test-Path ''node_modules'')) { npm install }; npm run dev"'
    $beResult = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = $backendCmd
        CurrentDirectory = $backendDir
    }

    if ($beResult.ReturnValue -eq 0) {
        Write-Host "-> Backend basariyla baslatildi! PID: $($beResult.ProcessId)" -ForegroundColor Green
        Write-Host "   API Health Endpoint: http://localhost:$backendPort/api/v1/health" -ForegroundColor Green
    } else {
        Write-Host "Hata: Backend sunucusu baslatilamadi. Hata Kodu: $($beResult.ReturnValue)" -ForegroundColor Red
    }
} else {
    Write-Host "Uyari: Backend klasoru ($backendDir) bulunamadi." -ForegroundColor Yellow
}

Write-Host "`nHer iki sunucu da bagimsiz arka plan surecleri olarak calisiyor." -ForegroundColor Yellow

if ($Wait -and $feResult.ProcessId) {
    Write-Host "Test tamamlanana kadar Frontend sureci izleniyor..." -ForegroundColor Cyan
    Wait-Process -Id $feResult.ProcessId -ErrorAction SilentlyContinue
}
