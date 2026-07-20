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
