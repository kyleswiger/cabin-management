# SES domain identity so Cognito emails (invites, password resets) come from
# our domain instead of no-reply@verificationemail.com. Requires custom_domain.
#
# NOTE: while the SES account is in sandbox, emails only deliver to verified
# recipients. Production access is requested separately (one-time, AWS-reviewed).

resource "aws_sesv2_email_identity" "domain" {
  count          = local.use_custom_domain ? 1 : 0
  email_identity = var.custom_domain
}

# DKIM: SES always issues exactly three CNAME tokens.
resource "aws_route53_record" "dkim" {
  count   = local.use_custom_domain ? 3 : 0
  zone_id = var.hosted_zone_id
  name    = "${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.custom_domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

# Custom MAIL FROM subdomain: aligns SPF with our domain for deliverability.
resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  count            = local.use_custom_domain ? 1 : 0
  email_identity   = aws_sesv2_email_identity.domain[0].email_identity
  mail_from_domain = "mail.${var.custom_domain}"
}

resource "aws_route53_record" "mail_from_mx" {
  count   = local.use_custom_domain ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = "mail.${var.custom_domain}"
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  count   = local.use_custom_domain ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = "mail.${var.custom_domain}"
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_route53_record" "dmarc" {
  count   = local.use_custom_domain ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = "_dmarc.${var.custom_domain}"
  type    = "TXT"
  ttl     = 600
  records = ["v=DMARC1; p=none;"]
}
