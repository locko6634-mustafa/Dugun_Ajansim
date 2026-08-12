param(
  [switch]$SkipBuild,
  [switch]$SkipCore,
  [switch]$SkipChannels
)

$ErrorActionPreference = "Stop"
$projectName = "dugun-ajansim-phase06"
$composeArgs = @("compose", "-f", "compose.quality.yaml", "-p", $projectName)
$sensitiveEnvironmentNames = @(
  "PHASE06_POSTGRES_PASSWORD",
  "PHASE06_RUNTIME_PASSWORD",
  "PHASE06_TURNSTILE_SECRET",
  "PHASE06_DATA_ENCRYPTION_KEY",
  "PHASE06_DATA_ENCRYPTION_KEYRING_JSON",
  "PHASE06_BLIND_INDEX_KEY",
  "PHASE06_BLIND_INDEX_KEYRING_JSON",
  "PHASE06_RATE_LIMIT_HMAC_KEY",
  "PHASE06_ADMIN_PASSWORD",
  "PHASE06_SALON_PASSWORD",
  "PHASE06_CUSTOMER_PASSWORD",
  "PHASE06_ADMIN_TOTP_SECRET",
  "PHASE06_DATABASE_URL",
  "PHASE06_RUNTIME_DATABASE_URL"
)

function New-Hex([int]$bytes = 32) {
  $buffer = New-Object byte[] $bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

function New-Base32([int]$length = 32) {
  $alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  $bytes = New-Object byte[] $length
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

function Invoke-Checked([string]$command, [string[]]$arguments) {
  & $command @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$command komutu $LASTEXITCODE koduyla başarısız oldu."
  }
}

function Mask-Line([string]$line) {
  $masked = $line
  foreach ($name in $sensitiveEnvironmentNames) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $masked = $masked.Replace($value, "[MASKED]") }
  }
  return $masked
}

$postgresPassword = "P6~Owner-$(New-Hex 24)"
$runtimePassword = "P6~Runtime-$(New-Hex 24)"
$dataKey = New-Hex
$blindKey = New-Hex
$rateLimitKey = New-Hex
$env:PHASE06_POSTGRES_PASSWORD = $postgresPassword
$env:PHASE06_RUNTIME_PASSWORD = $runtimePassword
$env:PHASE06_TURNSTILE_SECRET = New-Hex
$env:PHASE06_DATA_ENCRYPTION_KEY = $dataKey
$env:PHASE06_DATA_ENCRYPTION_KEYRING_JSON = (@{ phase06 = $dataKey } | ConvertTo-Json -Compress)
$env:PHASE06_BLIND_INDEX_KEY = $blindKey
$env:PHASE06_BLIND_INDEX_KEYRING_JSON = (@{ phase06 = $blindKey } | ConvertTo-Json -Compress)
$env:PHASE06_RATE_LIMIT_HMAC_KEY = $rateLimitKey
$env:PHASE06_ADMIN_PASSWORD = "P6!Admin-$(New-Hex 16)"
$env:PHASE06_SALON_PASSWORD = "P6!Salon-$(New-Hex 16)"
$env:PHASE06_CUSTOMER_PASSWORD = "P6!Musteri-$(New-Hex 16)"
$env:PHASE06_ADMIN_TOTP_SECRET = New-Base32
if (-not $env:PHASE06_HTTP_PORT) { $env:PHASE06_HTTP_PORT = "8186" }
if (-not $env:PHASE06_POSTGRES_PORT) { $env:PHASE06_POSTGRES_PORT = "55436" }
$env:PHASE06_BASE_URL = "http://127.0.0.1:$($env:PHASE06_HTTP_PORT)"
$env:PHASE06_DATABASE_URL = "postgresql://phase06_owner:${postgresPassword}@127.0.0.1:$($env:PHASE06_POSTGRES_PORT)/dugun_ajansim_phase06"
$env:PHASE06_RUNTIME_DATABASE_URL = "postgresql://phase06_runtime:${runtimePassword}@127.0.0.1:$($env:PHASE06_POSTGRES_PORT)/dugun_ajansim_phase06"
$releaseSha = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $releaseSha -notmatch "^[a-f0-9]{40}$") {
  throw "Release SHA okunamadı."
}
$env:PHASE06_RELEASE_SHA = $releaseSha

$resultDirectory = Join-Path $PSScriptRoot "..\test-results\phase06"
New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null
$primaryError = $null
$cleanupError = $null

try {
  Invoke-Checked "docker" ($composeArgs + @("config", "--quiet"))
  $upArguments = $composeArgs + @("up", "--detach")
  if (-not $SkipBuild) { $upArguments += "--build" }
  Invoke-Checked "docker" $upArguments

  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(4)
  $healthy = $false
  while ([DateTimeOffset]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "$($env:PHASE06_BASE_URL)/healthz" -TimeoutSec 3
      if ($response.StatusCode -eq 200) { $healthy = $true; break }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $healthy) { throw "Faz 06 frontend healthcheck zaman aşımına uğradı." }

  $manifest = [ordered]@{
    releaseSha = $releaseSha
    composeProject = $projectName
    generatedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
    syntheticDataOnly = $true
    productionSecretsUsed = $false
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $resultDirectory "release.json") -Encoding UTF8

  if (-not $SkipCore) {
    Invoke-Checked "npm" @("run", "test:phase06")
    Invoke-Checked "npm" @("run", "test:phase06:sanitize-har")
  }
  if (-not $SkipChannels -and $env:CI -ne "true") {
    Invoke-Checked "npm" @("run", "test:phase06:channels")
  }
} catch {
  $primaryError = $_
  New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null
  (& docker @composeArgs ps --all 2>&1) | ForEach-Object { Mask-Line "$_" } |
    Set-Content -LiteralPath (Join-Path $resultDirectory "compose-status.txt") -Encoding UTF8
  (& docker @composeArgs logs --no-color --tail 120 2>&1) | ForEach-Object { Mask-Line "$_" } |
    Set-Content -LiteralPath (Join-Path $resultDirectory "container-logs.txt") -Encoding UTF8
  if (-not $SkipCore) {
    try { Invoke-Checked "npm" @("run", "test:phase06:sanitize-har") } catch { }
  }
} finally {
  try {
    Invoke-Checked "docker" ($composeArgs + @("down", "--volumes", "--remove-orphans", "--timeout", "10"))
    $containers = ((& docker ps --all --quiet --filter "label=com.docker.compose.project=$projectName") | Out-String).Trim()
    $volumes = ((& docker volume ls --quiet --filter "label=com.docker.compose.project=$projectName") | Out-String).Trim()
    if ($containers -or $volumes) {
      throw "İzole Faz 06 container/volume cleanup doğrulaması başarısız."
    }
  } catch {
    $cleanupError = $_
  }
  foreach ($name in $sensitiveEnvironmentNames) {
    [Environment]::SetEnvironmentVariable($name, $null)
  }
}

if ($cleanupError) { throw $cleanupError }
if ($primaryError) { throw $primaryError }
Write-Output "Faz 06 izole full-stack kalite kapısı başarıyla tamamlandı ve ortam temizlendi."
