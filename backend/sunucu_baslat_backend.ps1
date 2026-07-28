# Backend Sunucusunu Bağımsız Başlatıcı
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptPath) { $scriptPath = Get-Location }

Write-Host "Backend dev sunucusu baslatiliyor (Port 5000)..." -ForegroundColor Cyan
Set-Location -Path $scriptPath

if (-not (Test-Path "$scriptPath\node_modules")) {
    Write-Host "node_modules bulunamadi. npm install calistiriliyor..." -ForegroundColor Yellow
    npm install
}

npm run dev
