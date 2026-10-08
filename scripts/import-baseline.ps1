param([Parameter(Mandatory=$true)][string]$SourceZip)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$appRoot = Join-Path $projectRoot 'app'
$expectedZipHash = '6B40554F6505BFB069B072CA3266B3A377FD49FFBAC642DFC4407348CB060852'
if (Test-Path -LiteralPath $appRoot) { throw 'app already exists; baseline import will not overwrite it.' }
$zipHash = (Get-FileHash -LiteralPath $SourceZip -Algorithm SHA256).Hash
if ($zipHash -ne $expectedZipHash) { throw 'Source ZIP differs from the inspected v0.2.1 release.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($SourceZip)
try {
  $entries = @($archive.Entries)
  foreach ($entry in $entries) {
    $entryName = $entry.FullName.Replace('\','/')
    if (-not $entryName.StartsWith('chuang-universe/')) { throw 'Unexpected ZIP prefix.' }
    $relative = $entryName.Substring('chuang-universe/'.Length)
    if (-not $relative -or $relative.EndsWith('/')) { throw 'Unexpected directory entry.' }
    if ($relative -match '(^|/)(\.|\.\.|\.cu-runtime|\.git|node_modules)(/|$)' -or $relative.Contains(':')) { throw 'Unsafe ZIP entry.' }
    $target = [IO.Path]::GetFullPath((Join-Path $appRoot $relative))
    if (-not $target.StartsWith($appRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP entry escapes app.' }
    if ($relative -match '(?i)(^|/)(setup-code|credentials|api-key|model-config|cookie|password)(\.|/|$)') { throw 'Private file in source ZIP.' }
  }
  [IO.Directory]::CreateDirectory($appRoot) | Out-Null
  foreach ($entry in $entries) {
    $relative = $entry.FullName.Replace('\','/').Substring('chuang-universe/'.Length)
    $target = [IO.Path]::GetFullPath((Join-Path $appRoot $relative))
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
  }
} finally { $archive.Dispose() }
$hashes = Get-Content -LiteralPath (Join-Path $appRoot 'SOURCE-HASHES.json') -Raw | ConvertFrom-Json
foreach ($file in $hashes) {
  $actual = (Get-FileHash -LiteralPath (Join-Path $appRoot $file.path) -Algorithm SHA256).Hash
  if ($actual -ne $file.sha256) { throw ('Source hash mismatch: ' + $file.path) }
}
$evidenceRoot = Join-Path $projectRoot 'evidence\provenance'
[IO.Directory]::CreateDirectory($evidenceRoot) | Out-Null
$report = [ordered]@{
  importedAtUtc = [DateTime]::UtcNow.ToString('o')
  sourceZip = [IO.Path]::GetFullPath($SourceZip)
  sourceZipSha256 = $zipHash.ToLowerInvariant()
  importedVersion = '0.2.1'
  extractedFiles = $entries.Count
  verifiedSourceFiles = $hashes.Count
  originalProjectModified = $false
  privateRuntimeImported = $false
  interpretation = 'Existing code baseline imported on the recorded date; not a reconstructed original Git history.'
}
$reportPath = Join-Path $evidenceRoot 'base-import.json'
$stream = [IO.File]::Open($reportPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
try { $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($report | ConvertTo-Json -Depth 5) + "`n"); $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
Write-Output ('Imported and verified {0} source files. Original release preserved.' -f $hashes.Count)
