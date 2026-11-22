$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install the current Node.js LTS from https://nodejs.org before continuing.' }
function Read-Secret([string]$Prompt) {
    $secureValue = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
$env:SITE_URL = Read-Host 'Website address (https://...)'
$env:AISSTREAM_API_KEY = Read-Secret 'Free AISStream API key (hidden)'
$env:VESSEL_INGEST_TOKEN = Read-Secret 'Collector token already configured on the website (hidden)'
try {
    if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) {
        npm install --omit=dev --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    node collect.mjs
} finally {
    Remove-Item Env:AISSTREAM_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:VESSEL_INGEST_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:SITE_URL -ErrorAction SilentlyContinue
}
