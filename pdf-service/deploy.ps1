# Windows convenience entrypoint only. Every actual deployment decision -- target validation, project/region/
# service/runtime-service-account selection from the versioned target registry, Cloud Run configuration, the
# dirty-working-tree guard, the source-upload boundary guard, and the Production confirmation gate -- lives in
# scripts/deploy-pdf.mjs. This wrapper duplicates none of it; it only translates familiar PowerShell flags into
# that script's arguments, and never contains its own Cloud Run CLI invocation logic.
#
# Real PDF deployment (UAT or Production, i.e. -Target without -DryRun) is supported only when the Node process
# this launches is actually running on macOS or Linux: real Windows execution of the Cloud Run deployment CLI has
# never been proven safe or exercised in this project (see deploy-pdf.mjs's assertPlatformSupportsRealDeploy), so
# scripts/deploy-pdf.mjs refuses a real deploy with a clear error whenever it detects it is running on Windows --
# before it ever touches git or that CLI. That check is based on the actual operating system the Node process
# runs on, not on which shell invoked it, so this same deploy.ps1 launched under PowerShell Core on macOS/Linux
# is unaffected.
#
# -DryRun is supported on every platform, including native Windows: it never invokes the deployment CLI at all,
# only prints the command that would run.
#
# Examples:
#   ./deploy.ps1 -Target uat -DryRun                  # works on any platform, including native Windows
#   ./deploy.ps1 -Target production -DryRun           # works on any platform, including native Windows
#   ./deploy.ps1 -Target uat                           # real deploy: only succeeds on macOS/Linux
#   ./deploy.ps1 -Target production -ConfirmProduction # real deploy: only succeeds on macOS/Linux
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
