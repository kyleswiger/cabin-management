#!/usr/bin/env bash
# Generate or rotate the CloudFront signed-cookie keypair for /media/* (PRD 5.8).
#
# The public key goes into the profile's terraform.tfvars (media_public_key_pem);
# the private key is written to the profile dir (gitignored) and pushed to the
# SSM SecureString parameter that the API Lambda reads at runtime. The private
# key is never stored in Terraform state or committed anywhere.
#
# Usage:
#   scripts/media-cf-keys.sh generate --profile DIR
#       Create (or rotate) the keypair: writes DIR/media-cf-private-key.pem,
#       backs up any existing key, and patches DIR/terraform.tfvars.
#   scripts/media-cf-keys.sh push --profile DIR [--param NAME]
#       Upload the private key to SSM. Reads the parameter name from
#       `terraform output` (infra/ must be initialized for this profile, i.e.
#       after a deploy.sh run) unless --param is given.
#
# Rotation sequence — run these back-to-back to minimize the broken window:
#   1. scripts/media-cf-keys.sh generate --profile DIR
#   2. ./deploy.sh --profile DIR            # applies the new public key
#   3. scripts/media-cf-keys.sh push --profile DIR
# Between steps 2 and 3 the API still signs with the old key while CloudFront
# only trusts the new one, so media loads fail; after step 3, browsers recover
# on their next /media-session refresh or page reload (sessions last 12h max).
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CMD="${1:-}"; shift || true
PROFILE="" PARAM=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="${2:?}"; shift 2 ;;
    --param) PARAM="${2:?}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ "$CMD" == "generate" || "$CMD" == "push" ]] || die "usage: $0 {generate|push} --profile DIR [--param NAME]"
[[ -n "$PROFILE" ]] || die "--profile DIR is required"
[[ -d "$PROFILE" ]] || die "profile dir not found: $PROFILE"
PROFILE="$(cd "$PROFILE" && pwd)"
KEY="$PROFILE/media-cf-private-key.pem"
TFVARS="$PROFILE/terraform.tfvars"

if [[ "$CMD" == "generate" ]]; then
  [[ -f "$TFVARS" ]] || die "no terraform.tfvars in $PROFILE"

  if [[ -f "$KEY" ]]; then
    BACKUP="$KEY.$(date +%Y%m%d-%H%M%S).bak"
    cp -p "$KEY" "$BACKUP"
    echo "Rotating: existing private key backed up to $BACKUP"
  fi

  # CloudFront signed cookies require RSA 2048.
  openssl genrsa -out "$KEY" 2048 2>/dev/null
  chmod 600 "$KEY"
  PUB="$(openssl rsa -in "$KEY" -pubout 2>/dev/null)"

  # Replace the existing media_public_key_pem heredoc block (or append one).
  TMP="$(mktemp)"
  awk '
    /^media_public_key_pem[[:space:]]*=/ { skip = 1; next }
    skip && /^EOT[[:space:]]*$/ { skip = 0; next }
    !skip { print }
  ' "$TFVARS" > "$TMP"
  {
    cat "$TMP"
    echo "media_public_key_pem = <<-EOT"
    echo "$PUB"
    echo "EOT"
  } > "$TFVARS"
  rm -f "$TMP"

  echo "Wrote $KEY (private, gitignored with the profile dir)"
  echo "Patched media_public_key_pem in $TFVARS"
  echo
  echo "Next: ./deploy.sh --profile $PROFILE   then   $0 push --profile $PROFILE"
  exit 0
fi

# push
[[ -f "$KEY" ]] || die "no private key at $KEY — run '$0 generate --profile $PROFILE' first"
if [[ -z "$PARAM" ]]; then
  PARAM="$(terraform -chdir="$REPO_ROOT/infra" output -raw media_cf_private_key_param 2>/dev/null)" \
    || die "could not read terraform output media_cf_private_key_param — run deploy.sh for this profile first, or pass --param NAME"
fi
aws ssm put-parameter --name "$PARAM" --type SecureString --overwrite \
  --value "file://$KEY" > /dev/null
echo "Private key pushed to SSM parameter: $PARAM"
echo "Existing browser sessions recover on their next /media-session refresh or page reload."
