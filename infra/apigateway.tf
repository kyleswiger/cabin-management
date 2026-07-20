resource "aws_apigatewayv2_api" "main" {
  name          = var.project
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = compact([
      "https://${aws_cloudfront_distribution.site.domain_name}",
      local.use_custom_domain ? "https://${var.custom_domain}" : "",
      "http://localhost:5173",
    ])
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.spa.id]
    issuer   = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

# Explicit methods only: an ANY route would also catch CORS preflight OPTIONS
# requests, which carry no Authorization header and would 401 at the authorizer.
# With no OPTIONS route, API Gateway's built-in CORS handling answers preflights.
resource "aws_apigatewayv2_route" "proxy" {
  for_each           = toset(["GET", "POST", "PUT", "DELETE"])
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "${each.key} /{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
