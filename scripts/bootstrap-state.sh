#!/usr/bin/env bash
# Create the S3 bucket and DynamoDB lock table that hold Terraform state.
#
# Usage: ./scripts/bootstrap-state.sh <bucket-name> [region] [lock-table]
#
# Deliberately plain AWS CLI rather than Terraform: the backend that stores state
# must not itself be managed by that state. Idempotent — safe to re-run.
set -euo pipefail

BUCKET="${1:-}"
REGION="${2:-us-east-1}"
TABLE="${3:-terraform-locks}"

if [ -z "$BUCKET" ]; then
  echo "Usage: $0 <bucket-name> [region] [lock-table]" >&2
  exit 2
fi

echo "==> Bucket: $BUCKET  Region: $REGION  Lock table: $TABLE"

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Bucket already exists, reusing it."
else
  echo "Creating bucket"
  # us-east-1 rejects a LocationConstraint; every other region requires one.
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION"
  fi
fi

echo "==> Blocking all public access"
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Versioning is the actual recovery mechanism: a corrupted or truncated state can
# be rolled back to a prior object version.
echo "==> Enabling versioning"
aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration "Status=Enabled"

echo "==> Enabling default encryption"
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'

echo "==> Denying non-TLS requests"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyInsecureTransport",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": ["arn:aws:s3:::$BUCKET", "arn:aws:s3:::$BUCKET/*"],
    "Condition": { "Bool": { "aws:SecureTransport": "false" } }
  }]
}
EOF
)"

# Keep old state versions for 90 days — long enough to recover a bad apply,
# short enough that the bucket does not grow without bound.
echo "==> Expiring noncurrent versions after 90 days"
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration \
  '{"Rules":[{"ID":"expire-old-state-versions","Status":"Enabled","Filter":{"Prefix":""},"NoncurrentVersionExpiration":{"NoncurrentDays":90},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}}]}'

# State locking. Terraform >= 1.10 can lock with an S3 object (use_lockfile) and
# drop this table; it is required on older versions.
if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "==> Lock table already exists, reusing it."
else
  echo "==> Creating lock table"
  aws dynamodb create-table \
    --table-name "$TABLE" \
    --region "$REGION" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
fi

cat <<EOF

Done. Put this in your profile as backend.hcl:

  bucket         = "$BUCKET"
  key            = "<project>/terraform.tfstate"
  region         = "$REGION"
  dynamodb_table = "$TABLE"
  encrypt        = true

Then run deploy.sh; it will offer to migrate existing local state.
EOF
