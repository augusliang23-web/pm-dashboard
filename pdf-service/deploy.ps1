# Production-only Cloud Run deployment. UAT verification must not invoke this script.
param(
  [string]$ProjectId = 'project-manager-dashboar-a067f',
  [string]$Region = 'asia-southeast1',
  [string]$ServiceName = 'pm-dashboard-pdf',
  [string]$AllowedOrigin = 'https://augusliang23-web.github.io',
  [string]$ServiceAccount = 'pm-dashboard-pdf@project-manager-dashboar-a067f.iam.gserviceaccount.com'
)

$ErrorActionPreference = 'Stop'

gcloud run deploy $ServiceName `
  --source . `
  --project $ProjectId `
  --region $Region `
  --allow-unauthenticated `
  --ingress all `
  --min-instances 0 `
  --max-instances 1 `
  --concurrency 1 `
  --cpu 1 `
  --memory 1Gi `
  --timeout 120 `
  --service-account $ServiceAccount `
  --set-env-vars "ALLOWED_ORIGIN=$AllowedOrigin" `
  --quiet
