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

output "table_name" {
  value = aws_dynamodb_table.main.name
}

output "region" {
  value = var.region
}
