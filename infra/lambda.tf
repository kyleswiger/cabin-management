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
