output "api_url" {
  value = aws_apigatewayv2_api.main.api_endpoint
}

output "site_url" {
  value = local.use_custom_domain ? "https://${var.custom_domain}" : "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "site_bucket" {
  value = aws_s3_bucket.site.bucket
}

output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "user_pool_client_id" {
  value = aws_cognito_user_pool_client.spa.id
}

output "media_bucket" {
  value = aws_s3_bucket.media.bucket
}

output "media_cf_key_pair_id" {
  value = aws_cloudfront_public_key.media.id
}

# Target for the operator's one-time `aws ssm put-parameter` of the private
# signing key (see media.tf).
output "media_cf_private_key_param" {
  value = aws_ssm_parameter.media_cf_private_key.name
}

output "table_name" {
  value = aws_dynamodb_table.main.name
}

output "region" {
  value = var.region
}

# ARN of the CI/CD deploy role, when cicd_repo is set. Save it as the profile
# repo's AWS_DEPLOY_ROLE_ARN variable; the deploy workflow assumes it.
output "cicd_role_arn" {
  value = local.cicd_enabled ? module.cicd_role[0].role_arn : ""
}
