# Origination identity for outbound SMS.
#
# US destinations don't accept sender IDs, so reminder texts need a real
# origination number in the account or SNS has nothing to send them from.
# Requesting the number is only half of it: toll-free numbers must also clear
# TFN registration before carriers will deliver, and that's a console/API
# workflow with a human review step — see README. Numbers bill monthly whether
# or not they've been registered, so this is opt-in per deployment.
resource "aws_pinpointsmsvoicev2_phone_number" "sms" {
  count = var.provision_sms_number ? 1 : 0

  iso_country_code    = "US"
  message_type        = "TRANSACTIONAL"
  number_capabilities = ["SMS"]
  number_type         = var.sms_number_type

  # A released number can't be reclaimed, and the TFN registration goes with
  # it — losing one means restarting a multi-day approval.
  deletion_protection_enabled = true

  tags = {
    Project = var.project
  }
}
