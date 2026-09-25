# Windows convenience entrypoint only. Every actual deployment decision -- target validation, project/region/
# service/runtime-service-account selection from the versioned target registry, Cloud Run configuration, the
# dirty-working-tree guard, and the Production confirmation gate -- lives in scripts/deploy-pdf.mjs. This wrapper
# duplicates none of it; it only translates familiar PowerShell flags into that script's arguments.
#
# Examples:
#   ./deploy.ps1 -Target uat -DryRun
#   ./deploy.ps1 -Target uat
#   ./deploy.ps1 -Target production -DryRun
#   ./deploy.ps1 -Target production -ConfirmProduction
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('uat', 'production')]
  [string]$Target,
  [switch]$DryRun,
  [switch]$ConfirmProduction
)

$ErrorActionPreference = 'Stop'

$deployScript = Join-Path $PSScriptRoot 'scripts/deploy-pdf.mjs'
$nodeArgs = @($deployScript, '--target', $Target)
if ($DryRun) { $nodeArgs += '--dry-run' }
if ($ConfirmProduction) { $nodeArgs += '--confirm-production' }

node @nodeArgs
exit $LASTEXITCODE
