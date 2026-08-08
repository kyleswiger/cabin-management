# Media pipeline (PRD 5.8, PRD 6): private media bucket, CloudFront signed-cookie
# serving via a /media/* behavior (see site.tf for the origin + behavior on the
# existing distribution), S3-event media-processing Lambda, and MediaConvert role.
#
# Bucket key layout (contract shared with backend/frontend — do not change):
#   originals/<albumId>/<mediaId>/original.<ext>
#   derived/<albumId>/<mediaId>/{web.jpg,thumb.jpg,poster.jpg,web.mp4}
# Browser URL: /media/<s3-key> on the site domain.

# --- Private media bucket -----------------------------------------------------

resource "aws_s3_bucket" "media" {
  bucket_prefix = "${var.project}-media-"
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Browser uploads PUT originals straight to S3 via presigned URLs (PRD 5.8), so
# the bucket must allow cross-origin PUT from the site and the Vite dev server.
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = compact([
      "https://${aws_cloudfront_distribution.site.domain_name}",
      local.use_custom_domain ? "https://${var.custom_domain}" : "",
      "http://localhost:5173",
    ])
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

# PRD 5.8 storage/cost: derivatives → Infrequent Access, originals → Glacier
# Instant Retrieval (still instantly retrievable), both at 90 days.
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "derived-to-standard-ia"
    status = "Enabled"
    filter {
      prefix = "derived/"
    }
    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }
  }

  rule {
    id     = "originals-to-glacier-ir"
    status = "Enabled"
    filter {
      prefix = "originals/"
    }
    transition {
      days          = 90
      storage_class = "GLACIER_IR"
    }
  }
}

# Only CloudFront (via OAC, see site.tf) may read objects.
data "aws_iam_policy_document" "media_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = data.aws_iam_policy_document.media_bucket.json
}

# --- CloudFront signed-cookie key material (PRD 5.8) --------------------------
#
# Keypair generation (operator, once per deployment):
#   openssl genrsa -out media_cf_private_key.pem 2048
#   openssl rsa -in media_cf_private_key.pem -pubout -out media_cf_public_key.pem
# The PUBLIC key goes into terraform.tfvars as media_public_key_pem (see
# profile.example/terraform.tfvars). The PRIVATE key never enters Terraform or
# state — after the first apply, store it out-of-band in the SSM parameter below:
#   aws ssm put-parameter --name "$(terraform output -raw media_cf_private_key_param)" \
#     --type SecureString --value file://media_cf_private_key.pem --overwrite

resource "aws_cloudfront_public_key" "media" {
  name        = "${var.project}-media"
  comment     = "Signed-cookie verification key for /media/* (PRD 5.8)"
  encoded_key = var.media_public_key_pem
}

resource "aws_cloudfront_key_group" "media" {
  name    = "${var.project}-media"
  comment = "Trusted key group for the /media/* behavior (PRD 5.8)"
  items   = [aws_cloudfront_public_key.media.id]
}

# The API Lambda signs cookies with the matching private key, read at runtime
# from this SecureString. Terraform creates the parameter with a placeholder and
# ignores value changes; the operator sets the real key with the put-parameter
# command above. Never put the private key in tfvars or state.
resource "aws_ssm_parameter" "media_cf_private_key" {
  name  = "/${var.project}/media-cf-private-key"
  type  = "SecureString"
  value = "PLACEHOLDER - set the real CloudFront private key out-of-band (see media.tf)"

  lifecycle {
    ignore_changes = [value]
  }
}

# Rewrites /media/<key> → /<key> before the request reaches the S3 origin.
# origin_path can't do this: it *prepends* a fixed path to the origin request
# and cannot strip the incoming /media prefix, and the contract pins objects at
# the bucket root (originals/..., derived/...). A viewer-request CloudFront
# Function is the lightweight way to drop the prefix.
resource "aws_cloudfront_function" "media_uri_rewrite" {
  name    = "${var.project}-media-uri-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Strip the /media prefix so /media/<key> fetches s3://media-bucket/<key> (PRD 5.8)"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      request.uri = request.uri.replace(/^\/media\//, "/");
      return request;
    }
  EOT
}

# --- MediaConvert service role (PRD 5.8: H.264 MP4 for non-web-playable video) -

data "aws_iam_policy_document" "mediaconvert_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["mediaconvert.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "mediaconvert" {
  name               = "${var.project}-mediaconvert"
  assume_role_policy = data.aws_iam_policy_document.mediaconvert_assume.json
}

data "aws_iam_policy_document" "mediaconvert_permissions" {
  statement {
    sid       = "ReadOriginals"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/originals/*"]
  }

  statement {
    sid       = "WriteDerived"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.media.arn}/derived/*"]
  }
}

resource "aws_iam_role_policy" "mediaconvert" {
  name   = "${var.project}-mediaconvert"
  role   = aws_iam_role.mediaconvert.id
  policy = data.aws_iam_policy_document.mediaconvert_permissions.json
}

# --- Media-processing Lambda (PRD 5.8: S3 event → derivatives) ----------------

resource "aws_iam_role" "media_lambda" {
  name               = "${var.project}-media-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "media_lambda_permissions" {
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
    sid = "MediaBucket"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.media.arn}/*"]
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

  # MediaConvert has no resource-level job ARNs at CreateJob time and
  # DescribeEndpoints is account-scoped, so both need "*".
  statement {
    sid = "MediaConvert"
    actions = [
      "mediaconvert:CreateJob",
      "mediaconvert:DescribeEndpoints",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "PassMediaConvertRole"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.mediaconvert.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["mediaconvert.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "media_lambda" {
  name   = "${var.project}-media-lambda"
  role   = aws_iam_role.media_lambda.id
  policy = data.aws_iam_policy_document.media_lambda_permissions.json
}

# sharp + libvips/libheif layer (PRD 5.8): built by the Docker script under
# backend/layers/sharp-heif/. Like the api/reminders zips (built by deploy.sh
# via `npm run build`), the artifact must exist before terraform runs — there
# is deliberately no fileexists() guard so a missing build fails loudly.
resource "aws_lambda_layer_version" "sharp_heif" {
  layer_name          = "${var.project}-sharp-heif"
  filename            = "${path.module}/../backend/layers/sharp-heif/dist/layer.zip"
  source_code_hash    = filebase64sha256("${path.module}/../backend/layers/sharp-heif/dist/layer.zip")
  compatible_runtimes = ["nodejs22.x"]
}

# Sized for sharp: HEIC decode of large iPhone originals is memory-hungry, and
# more memory also buys proportionally more CPU on Lambda.
resource "aws_lambda_function" "media" {
  function_name    = "${var.project}-media"
  role             = aws_iam_role.media_lambda.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = "${path.module}/../backend/dist/media.zip"
  source_code_hash = filebase64sha256("${path.module}/../backend/dist/media.zip")
  layers           = [aws_lambda_layer_version.sharp_heif.arn]
  memory_size      = 1536
  timeout          = 120

  environment {
    variables = {
      MEDIA_BUCKET          = aws_s3_bucket.media.bucket
      TABLE_NAME            = aws_dynamodb_table.main.name
      MEDIACONVERT_ROLE_ARN = aws_iam_role.mediaconvert.arn
    }
  }
}

resource "aws_cloudwatch_log_group" "media" {
  name              = "/aws/lambda/${aws_lambda_function.media.function_name}"
  retention_in_days = 30
}

resource "aws_lambda_permission" "media_s3" {
  statement_id  = "AllowS3MediaBucket"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.media.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.media.arn
}

# Uploads land under originals/ only (presigned PUT from the API); derivatives
# under derived/ must not re-trigger processing.
resource "aws_s3_bucket_notification" "media" {
  bucket = aws_s3_bucket.media.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.media.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "originals/"
  }

  depends_on = [aws_lambda_permission.media_s3]
}
