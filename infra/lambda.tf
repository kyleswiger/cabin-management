locals {
  # Message copy the Lambdas emit (SMS reminders, project notifications).
  lambda_branding_env = {
    APP_NAME                       = local.branding.appName
    PROPERTY_NOUN                  = local.branding.propertyNoun
    PRIORITY_USER_LABEL            = local.branding.priorityUserLabel
    PRIORITY_USER_LABEL_POSSESSIVE = local.branding.priorityUserLabelPossessive
  }
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.project}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "lambda_permissions" {
  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }

  statement {
    sid = "Dynamo"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
    ]
    resources = [
      aws_dynamodb_table.main.arn,
      "${aws_dynamodb_table.main.arn}/index/*",
    ]
  }

  statement {
    sid       = "SmsPublish"
    actions   = ["sns:Publish"]
    resources = ["*"]
    # Publishing SMS directly to a phone number requires resource "*";
    # deny topic publishes to keep this scoped to SMS only.
    condition {
      test     = "StringNotLike"
      variable = "sns:Protocol"
      values   = ["http*"]
    }
  }

  # Notification email. Scoped to the deployment's own verified identity rather than "*" so this
  # role cannot send as any other identity in the account. Only present when the deployment has a
  # custom domain — without one there is no verified identity and sendEmail() skips.
  dynamic "statement" {
    for_each = local.use_custom_domain ? [1] : []
    content {
      sid       = "NotificationEmail"
      actions   = ["ses:SendEmail"]
      resources = [aws_sesv2_email_identity.domain[0].arn]
    }
  }

  statement {
    sid = "CognitoAdmin"
    actions = [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminRemoveUserFromGroup",
    ]
    resources = [aws_cognito_user_pool.main.arn]
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${var.project}-lambda"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_permissions.json
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.project}-api"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = "${path.module}/../backend/dist/api.zip"
  source_code_hash = filebase64sha256("${path.module}/../backend/dist/api.zip")
  memory_size      = 256
  timeout          = 15

  environment {
    variables = merge(local.lambda_branding_env, {
      TABLE_NAME   = aws_dynamodb_table.main.name
      USER_POOL_ID = aws_cognito_user_pool.main.id
      SITE_URL     = local.site_url
      # Empty without a custom domain — sendEmail() treats that as "no verified sender" and
      # skips rather than erroring per recipient.
      NOTIFICATION_FROM_ADDRESS = local.use_custom_domain ? "no-reply@${var.custom_domain}" : ""
    })
  }
}

resource "aws_lambda_function" "reminders" {
  function_name    = "${var.project}-reminders"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = "${path.module}/../backend/dist/reminders.zip"
  source_code_hash = filebase64sha256("${path.module}/../backend/dist/reminders.zip")
  memory_size      = 256
  timeout          = 60

  environment {
    variables = merge(local.lambda_branding_env, {
      TABLE_NAME   = aws_dynamodb_table.main.name
      USER_POOL_ID = aws_cognito_user_pool.main.id
      SITE_URL     = local.site_url
      # Empty without a custom domain — sendEmail() treats that as "no verified sender" and
      # skips rather than erroring per recipient.
      NOTIFICATION_FROM_ADDRESS = local.use_custom_domain ? "no-reply@${var.custom_domain}" : ""
    })
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${aws_lambda_function.api.function_name}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "reminders" {
  name              = "/aws/lambda/${aws_lambda_function.reminders.function_name}"
  retention_in_days = 30
}
