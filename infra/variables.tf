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

variable "cicd_repo" {
  description = <<-EOT
    Deployment profile repository in "owner/repo" form (e.g. "kyleswiger/jackscabin-mgmt").
    Set it to create a keyless GitHub Actions role that can deploy this stack, so
    releases ship from CI instead of from a workstation. Empty means manual deploys.
  EOT
  type        = string
  default     = ""
}

variable "cicd_environment" {
  description = "GitHub Environment the deploy job runs in. The role trusts this name in the OIDC subject claim, so it must match the workflow's `environment:` exactly."
  type        = string
  default     = "prod"
}

variable "cicd_create_oidc_provider" {
  description = "Create the account's GitHub OIDC provider. Leave false when another stack in the same account already manages it — a second provider for the same URL is an API error."
  type        = bool
  default     = false
}

variable "cicd_state_bucket" {
  description = "S3 bucket holding this deployment's Terraform state (from the profile's backend.hcl). Grants CI access to it. Empty for local state."
  type        = string
  default     = ""
}

variable "cicd_lock_table" {
  description = "DynamoDB table used for Terraform state locking. Empty to skip."
  type        = string
  default     = ""
}

variable "media_public_key_pem" {
  description = <<-EOT
    PEM-encoded 2048-bit RSA PUBLIC key for CloudFront signed cookies on /media/* (PRD 5.8).
    Generate the pair once per deployment:
      openssl genrsa -out media_cf_private_key.pem 2048
      openssl rsa -in media_cf_private_key.pem -pubout -out media_cf_public_key.pem
    Paste the public key here (tfvars). The PRIVATE key never enters Terraform —
    store it in the SSM parameter after the first apply (see media.tf).
  EOT
  type        = string
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
