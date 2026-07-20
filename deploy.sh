#!/usr/bin/env bash
# Full deploy: backend zips → terraform apply → frontend build → S3 sync → CloudFront invalidation.
#
# Usage: ./deploy.sh [--profile DIR] [-auto-approve]
#
# Everything deployment-specific lives in the profile directory, never in this repo:
#   DIR/cabin.config.json   branding and message copy (required)
#   DIR/terraform.tfvars    project name, region, custom domain (required)
#   DIR/terraform.tfstate   Terraform state (created on first apply)
#   DIR/public/             optional static files overlaid onto the built site
#
# Defaults to ./profile.example so the repo deploys standalone.
set -euo pipefail
cd "$(dirname "$0")"
REPO="$PWD"

PROFILE="$REPO/profile.example"
APPROVE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    -auto-approve|--auto-approve) APPROVE="-auto-approve"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

PROFILE="$(cd "$PROFILE" && pwd)"
CONFIG="$PROFILE/cabin.config.json"
TFVARS="$PROFILE/terraform.tfvars"
TFSTATE="$PROFILE/terraform.tfstate"

for f in "$CONFIG" "$TFVARS"; do
  [ -f "$f" ] || { echo "Missing required profile file: $f" >&2; exit 1; }
done
echo "==> Profile: $PROFILE"

echo "==> Building backend Lambda bundles"
(cd backend && npm run build)

echo "==> Applying Terraform"
(cd infra \
  && terraform init -input=false >/dev/null \
  && terraform apply -input=false $APPROVE \
       -var-file="$TFVARS" \
       -var="app_config_file=$CONFIG" \
       -state="$TFSTATE")

tf_out() { (cd infra && terraform output -state="$TFSTATE" -raw "$1"); }

echo "==> Reading Terraform outputs"
API_URL=$(tf_out api_url)
USER_POOL_ID=$(tf_out user_pool_id)
CLIENT_ID=$(tf_out user_pool_client_id)
BUCKET=$(tf_out site_bucket)
DIST_ID=$(tf_out cloudfront_distribution_id)
SITE_URL=$(tf_out site_url)

echo "==> Building frontend"
cat > frontend/.env.production <<EOF
VITE_API_URL=$API_URL
VITE_USER_POOL_ID=$USER_POOL_ID
VITE_CLIENT_ID=$CLIENT_ID
EOF
(cd frontend && CABIN_CONFIG="$CONFIG" npm run build)

# Profile-supplied favicons, images, etc. win over the repo defaults.
if [ -d "$PROFILE/public" ]; then
  echo "==> Overlaying profile public/ assets"
  cp -R "$PROFILE/public/." frontend/dist/
fi

echo "==> Uploading site to s3://$BUCKET"
aws s3 sync frontend/dist "s3://$BUCKET" --delete

echo "==> Invalidating CloudFront cache"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null

echo ""
echo "Deployed: $SITE_URL"
