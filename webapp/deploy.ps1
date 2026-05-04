# Familyboard — Windows / PowerShell deployment helper.
# Mirrors webapp/deploy.sh; kept for maintainers who prefer PowerShell
# over Git Bash / WSL2.
#
# Configuration: pass as parameters, set via environment variables, or
# put values in a gitignored deploy-config.local.ps1 next to this file.
#
# Required:
#   -RemoteHost   remote SSH host (or $env:DEPLOY_HOST)
#   -RemotePath   absolute path on remote (or $env:DEPLOY_PATH)
# Optional:
#   -Port         SSH port (default 22)
#   -User         SSH user (default root)
#   -SshKey       SSH key path (default ~/.ssh/id_ed25519)
#   -ProjectName  container prefix (default familyboard)
#   -PublicUrl    URL to print on success
#
# Examples:
#   .\deploy.ps1 -RemoteHost nas.example.com -RemotePath /mnt/user/appdata/familyboard
#   .\deploy.ps1 -MigrationOnly

param(
    [string]$RemoteHost = $env:DEPLOY_HOST,
    [int]$Port = $(if ($env:DEPLOY_PORT) { [int]$env:DEPLOY_PORT } else { 22 }),
    [string]$User = $(if ($env:DEPLOY_USER) { $env:DEPLOY_USER } else { "root" }),
    [string]$RemotePath = $env:DEPLOY_PATH,
    [string]$SshKey = $(if ($env:DEPLOY_SSH_KEY) { $env:DEPLOY_SSH_KEY } else { "$env:USERPROFILE\.ssh\id_ed25519" }),
    [string]$ProjectName = $(if ($env:PROJECT_NAME) { $env:PROJECT_NAME } else { "familyboard" }),
    [string]$PublicUrl = $env:PUBLIC_URL,
    [switch]$MigrationOnly,
    [switch]$SkipMigration,
    [switch]$SkipCleanup,
    [switch]$CleanupOnly
)

$ErrorActionPreference = "Stop"

# Source per-host overrides if present (gitignored)
$LocalConfig = Join-Path $PSScriptRoot "..\deploy-config.local.ps1"
if (Test-Path $LocalConfig) {
    . $LocalConfig
}

if (-not $RemoteHost -or -not $RemotePath) {
    Write-Error "RemoteHost and RemotePath must be set (params, env vars, or deploy-config.local.ps1)."
    exit 2
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Familyboard Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Target: $User@${RemoteHost}:$Port" -ForegroundColor Yellow
Write-Host "Path: $RemotePath" -ForegroundColor Yellow
Write-Host ""

function Invoke-SSH {
    param([string]$Command)
    Write-Host "  > $Command" -ForegroundColor DarkGray
    ssh -i $SshKey -o StrictHostKeyChecking=no -p $Port "${User}@${RemoteHost}" $Command
    if ($LASTEXITCODE -ne 0) { throw "SSH failed" }
}

function Invoke-DockerCleanup {
    Write-Host ""
    Write-Host "[Cleanup] Cleaning Docker build data..." -ForegroundColor Magenta

    # Remove dangling images (layers not tagged or referenced)
    Write-Host "  Removing dangling images..." -ForegroundColor Yellow
    Invoke-SSH "docker image prune -f"

    # Remove old webapp images (keep only the latest)
    Write-Host "  Removing old webapp images..." -ForegroundColor Yellow
    Invoke-SSH "docker images '${ProjectName}*' --format '{{.ID}} {{.CreatedAt}}' | sort -k2 -r | tail -n +2 | awk '{print \$1}' | xargs -r docker rmi -f 2>/dev/null || true"

    # Clear Docker build cache
    Write-Host "  Clearing build cache..." -ForegroundColor Yellow
    Invoke-SSH "docker builder prune -f"

    # Show disk usage after cleanup
    Write-Host "  Docker disk usage:" -ForegroundColor Yellow
    Invoke-SSH "docker system df"

    Write-Host "  Cleanup done!" -ForegroundColor Green
}

# Handle cleanup-only mode
if ($CleanupOnly) {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Docker Cleanup Only" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Invoke-DockerCleanup
    exit 0
}

# Step 1: Apply database migrations
if (-not $SkipMigration) {
    Write-Host "[1/6] Applying database migrations..." -ForegroundColor Green

    # Find all migration files and apply them in order
    $migrationFiles = @(
        "migration.sql",
        "migration_fingerprint.sql"
    )

    $appliedCount = 0
    foreach ($migrationName in $migrationFiles) {
        $migrationFile = Join-Path $PSScriptRoot "docker\$migrationName"
        if (Test-Path $migrationFile) {
            Write-Host "  Applying $migrationName..." -ForegroundColor Yellow
            scp -i $SshKey -o StrictHostKeyChecking=no -P $Port $migrationFile "${User}@${RemoteHost}:/tmp/$migrationName"
            if ($LASTEXITCODE -ne 0) { throw "Migration file upload failed: $migrationName" }

            Invoke-SSH "docker cp /tmp/$migrationName ${ProjectName}-db:/tmp/$migrationName"
            Invoke-SSH "docker exec ${ProjectName}-db psql -U postgres -d postgres -f /tmp/$migrationName"
            Invoke-SSH "rm /tmp/$migrationName"
            $appliedCount++
        }
    }

    if ($appliedCount -eq 0) {
        Write-Host "  No migration files found, skipping..." -ForegroundColor Yellow
    } else {
        Write-Host "  Applied $appliedCount migration(s)" -ForegroundColor Green
        # Restart PostgREST to reload schema cache (required after schema changes)
        Write-Host "  Restarting PostgREST to reload schema..." -ForegroundColor Yellow
        Invoke-SSH "docker restart ${ProjectName}-rest"
        Start-Sleep -Seconds 3
    }

    Write-Host "  Done!" -ForegroundColor Green

    if ($MigrationOnly) {
        Write-Host "`nMigration complete!" -ForegroundColor Green
        exit 0
    }
}

# Step 2: Create and upload archive
Write-Host "[2/6] Uploading webapp source..." -ForegroundColor Green
$webappPath = $PSScriptRoot
$tempArchive = Join-Path $env:TEMP "webapp.tar.gz"

Write-Host "  Creating archive..." -ForegroundColor Yellow
# Use PowerShell's Compress-Archive alternative via tar.exe (Windows 10+)
Set-Location $webappPath
# Use Windows tar.exe directly (not git bash tar)
$tarExe = "C:\Windows\System32\tar.exe"
& $tarExe --exclude='node_modules' --exclude='.next' --exclude='.git' -czf $tempArchive .
if ($LASTEXITCODE -ne 0) { throw "Archive creation failed" }

Write-Host "  Uploading to server..." -ForegroundColor Yellow
scp -i $SshKey -o StrictHostKeyChecking=no -P $Port $tempArchive "${User}@${RemoteHost}:/tmp/"
if ($LASTEXITCODE -ne 0) { throw "Upload failed" }

Write-Host "  Extracting on server..." -ForegroundColor Yellow
# Backup production .env before extracting (it contains secrets not in the repo)
Invoke-SSH "mkdir -p $RemotePath/webapp && cd $RemotePath/webapp && cp docker/.env /tmp/env.backup 2>/dev/null || true && rm -rf src public docker components.json next.config.mjs package.json package-lock.json tailwind.config.ts tsconfig.json postcss.config.mjs && tar -xzf /tmp/webapp.tar.gz && rm /tmp/webapp.tar.gz && cp /tmp/env.backup docker/.env 2>/dev/null || true && rm /tmp/env.backup 2>/dev/null || true"
Remove-Item $tempArchive -ErrorAction SilentlyContinue
Write-Host "  Done!" -ForegroundColor Green

# Step 3: Rebuild webapp container
Write-Host "[3/6] Building Docker image..." -ForegroundColor Green
Invoke-SSH "cd $RemotePath/webapp/docker && docker-compose build webapp"

# Step 4: Restart webapp
Write-Host "[4/6] Restarting webapp..." -ForegroundColor Green
Invoke-SSH "docker stop ${ProjectName}-webapp 2>/dev/null; docker rm ${ProjectName}-webapp 2>/dev/null; cd $RemotePath/webapp/docker && docker-compose up -d --no-deps webapp"

# Step 5: Start go2rtc (RTSP to WebRTC converter)
Write-Host "[5/6] Starting go2rtc..." -ForegroundColor Green
Invoke-SSH "cd $RemotePath/webapp/docker && docker-compose up -d go2rtc"

# Step 6: Clean up Docker build data
if (-not $SkipCleanup) {
    Write-Host "[6/6] Cleaning up Docker build data..." -ForegroundColor Green
    Invoke-DockerCleanup
} else {
    Write-Host "[6/6] Skipping cleanup (use -CleanupOnly to run separately)" -ForegroundColor Yellow
}

# Done
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Invoke-SSH "docker ps --filter name=${ProjectName}-webapp --filter name=${ProjectName}-go2rtc --format 'table {{.Names}}\t{{.Status}}'"
if ($PublicUrl) {
    Write-Host ""
    Write-Host "URL: $PublicUrl" -ForegroundColor Cyan
}
