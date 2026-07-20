resource "aws_cognito_user_pool" "main" {
  name = var.project

  # Invite-only: no public sign-up (PRD 5.1).
  # Note: {username} is deliberately omitted from the email — with email-based
  # usernames Cognito renders it as an opaque UUID, which confuses invitees.
  admin_create_user_config {
    allow_admin_create_user_only = true
    invite_message_template {
      email_subject = "You're invited to ${local.branding.longName}"
      # {username} is required by validation but renders an opaque UUID for
      # email-username pools, so it's visually hidden.
      email_message = "${local.branding.inviteIntro}<br><br>${local.use_custom_domain ? "Sign in at <a href=\"${local.site_url}\">${local.site_url}</a> using this email address" : "Sign in using this email address"} and your temporary password: {####}<br><br>You'll pick your own password the first time you sign in.<span style=\"display:none\">{username}</span>"
      sms_message   = "${local.branding.longName} login: {username} / {####}"
    }
  }

  # Used for forgot-password codes.
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "${local.branding.longName} password reset"
    email_message        = "Your password reset code is {####}. Enter it on the reset screen${local.use_custom_domain ? " at ${local.site_url}" : ""}."
  }

  # Send from our own domain via SES when a custom domain is configured.
  dynamic "email_configuration" {
    for_each = local.use_custom_domain ? [1] : []
    content {
      email_sending_account = "DEVELOPER"
      from_email_address    = "${local.branding.longName} <no-reply@${var.custom_domain}>"
      source_arn            = aws_sesv2_email_identity.domain[0].arn
    }
  }

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 10
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  schema {
    name                = "name"
    attribute_data_type = "String"
    mutable             = true
    required            = true
    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }
}

resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.project}-spa"
  user_pool_id = aws_cognito_user_pool.main.id

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Admins: user invites, settings, backlog deletion"
}
