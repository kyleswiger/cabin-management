variable "project" {
  description = "Name prefix for all AWS resources. Must be unique per deployment."
  type        = string
  default     = "thecabin"
}

variable "app_config_file" {
  description = "Path to the deployment profile's cabin.config.json (branding/copy)."
  type        = string
  default     = "../profile.example/cabin.config.json"
}

variable "region" {
  description = "AWS region (us-east-1 recommended: ACM certs for CloudFront must live there)"
  type        = string
  default     = "us-east-1"
}

variable "custom_domain" {
  description = "Optional custom domain for the site (e.g. cabin.example.com). Leave empty to use the CloudFront domain."
  type        = string
  default     = ""
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for custom_domain. Required when custom_domain is set."
  type        = string
  default     = ""
}

variable "reminder_schedule" {
  description = "EventBridge Scheduler cron for the daily reminder run (UTC). Default 15:00 UTC ≈ morning US."
  type        = string
  default     = "cron(0 15 * * ? *)"
}

variable "provision_sms_number" {
  description = "Buy a dedicated origination number for reminder SMS. US SMS won't deliver without one, but the number bills monthly and toll-free requires TFN registration before carriers accept traffic."
  type        = bool
  default     = false
}

variable "sms_number_type" {
  description = "Origination number type when provision_sms_number is set. TOLL_FREE registers fastest; TEN_DLC needs a brand and campaign first."
  type        = string
  default     = "TOLL_FREE"

  validation {
    condition     = contains(["TOLL_FREE", "TEN_DLC"], var.sms_number_type)
    error_message = "sms_number_type must be TOLL_FREE or TEN_DLC."
  }
}

locals {
  use_custom_domain = var.custom_domain != ""

  # Single source of truth for naming: the same file the frontend build reads.
  branding = jsondecode(file(var.app_config_file))

  # Cognito requires an absolute URL in invite/reset mail; without a custom
  # domain the CloudFront URL isn't known until after the distribution exists,
  # so fall back to a relative instruction.
  site_url = local.use_custom_domain ? "https://${var.custom_domain}" : ""
}
