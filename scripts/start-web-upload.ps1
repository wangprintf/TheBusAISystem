param(
    [string]$CredentialCsv = (Join-Path (Split-Path -Parent $PSScriptRoot) '..\SecretKey.csv'),
    [string]$BackendUrl
)
$ErrorActionPreference = 'Stop'
$credential = @(Import-Csv -LiteralPath $CredentialCsv)
if ($credential.Count -ne 1 -or !$credential[0].SecretId -or !$credential[0].SecretKey) {
    throw 'Credential CSV must contain exactly one row with SecretId and SecretKey.'
}
$oldId = $env:TENCENT_COS_SECRET_ID
$oldKey = $env:TENCENT_COS_SECRET_KEY
$oldBackendUrl = $env:WEB_API_UPSTREAM
try {
    $env:TENCENT_COS_SECRET_ID = $credential[0].SecretId.Trim()
    $env:TENCENT_COS_SECRET_KEY = $credential[0].SecretKey.Trim()
    if ($BackendUrl) {
        $backendUri = [Uri]$BackendUrl
        if (!$backendUri.IsAbsoluteUri -or $backendUri.Scheme -notin @('http', 'https') -or $backendUri.UserInfo -or $backendUri.Query -or $backendUri.Fragment -or $backendUri.AbsolutePath -ne '/') {
            throw 'BackendUrl must be an HTTP(S) origin, for example http://127.0.0.1:8282.'
        }
        $env:WEB_API_UPSTREAM = $backendUri.GetLeftPart([UriPartial]::Authority)
    }
    $serverScript = Join-Path $PSScriptRoot '..\server\web-finish-server.mjs'
    & node $serverScript
    if ($LASTEXITCODE -ne 0) { throw "Upload service exited with code $LASTEXITCODE" }
} finally {
    $env:TENCENT_COS_SECRET_ID = $oldId
    $env:TENCENT_COS_SECRET_KEY = $oldKey
    $env:WEB_API_UPSTREAM = $oldBackendUrl
    $credential = $null
}
