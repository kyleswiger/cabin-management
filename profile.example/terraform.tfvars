# Infrastructure parameters for this deployment.
# `project` prefixes every AWS resource name and must be unique per deployment.
project = "thecabin"
region  = "us-east-1"

# Optional custom domain. Leave both empty to use the CloudFront domain.
# Setting these also enables SES so Cognito mail comes from no-reply@<domain>.
custom_domain  = ""
hosted_zone_id = ""

# Daily reminder run (UTC). Default 15:00 UTC ≈ morning in the US.
reminder_schedule = "cron(0 15 * * ? *)"

# CloudFront signed-cookie keypair for the private media bucket (PRD 5.8).
# Generate once per deployment:
#   openssl genrsa -out media_cf_private_key.pem 2048
#   openssl rsa -in media_cf_private_key.pem -pubout -out media_cf_public_key.pem
# Paste the PUBLIC key below. The PRIVATE key must never enter Terraform or
# git: after the first apply, store it in SSM out-of-band —
#   aws ssm put-parameter \
#     --name "$(cd infra && terraform output -raw media_cf_private_key_param)" \
#     --type SecureString --overwrite \
#     --value file://media_cf_private_key.pem
media_public_key_pem = <<-EOT
-----BEGIN PUBLIC KEY-----
REPLACE with the contents of media_cf_public_key.pem
-----END PUBLIC KEY-----
EOT
