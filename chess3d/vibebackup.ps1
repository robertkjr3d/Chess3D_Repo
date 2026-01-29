param([Parameter(ValueFromRemainingArguments=$true)] $Args)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backupScript = Join-Path $scriptDir 'frontend\scripts\backup.js'
if (-not (Test-Path $backupScript)) {
  Write-Error "Backup script not found: $backupScript"
  exit 2
}
& node $backupScript @Args
