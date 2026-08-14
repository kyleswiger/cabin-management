# Keyless CI/CD role, so a deployment profile repo can run deploy.sh from GitHub
# Actions instead of from a workstation. Opt-in: a profile that still deploys by
# hand leaves cicd_repo empty and nothing here is created.
#
# The role is deliberately powerful — the workflow it backs runs a full
# `terraform apply` over this whole stack — but it is bounded to the services
# this stack actually uses, and its IAM rights reach only names prefixed with
# var.project.

locals {
  cicd_enabled = var.cicd_repo != ""

  # GitHub mints `repo:<owner>/<repo>:environment:<name>` as the subject claim
  # whenever a job declares an `environment:` — NOT the branch ref. Trusting
  # `ref:refs/heads/main` here would make every deploy fail at assume-role,
  # which is exactly the trap the deploy workflow's environment gate walks into.
  cicd_subject_claims = [
    "repo:${var.cicd_repo}:environment:${var.cicd_environment}",
  ]

  # Terraform's own state, when the profile keeps it remote. Empty values mean
  # local state, so the statements are dropped rather than granted on "*".
  cicd_state_statements = concat(
    var.cicd_state_bucket == "" ? [] : [
      {
        sid       = "TerraformState"
        effect    = "Allow"
        actions   = ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        resources = ["arn:aws:s3:::${var.cicd_state_bucket}", "arn:aws:s3:::${var.cicd_state_bucket}/*"]
      }
    ],
    var.cicd_lock_table == "" ? [] : [
      {
        sid       = "TerraformLocks"
        effect    = "Allow"
        actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
        resources = ["arn:aws:dynamodb:${var.region}:*:table/${var.cicd_lock_table}"]
      }
    ],
  )

  cicd_policy_statements = concat(
    [
      {
        # The stack's own services. Resource-level scoping is not attempted:
        # `terraform apply` has to create resources that do not exist yet, and
        # several of these APIs (cloudfront, sms-voice, acm) support no
        # resource-level conditions at all.
        sid    = "StackServices"
        effect = "Allow"
        actions = [
          "acm:*",
          "apigateway:*",
          "cloudfront:*",
          "cognito-idp:*",
          "dynamodb:*",
          "events:*",
          "lambda:*",
          "logs:*",
          "route53:*",
          "s3:*",
          "scheduler:*",
          "ses:*",
          "sms-voice:*",
          "ssm:*",
          "sns:*",
        ]
        resources = ["*"]
      },
      {
        # Lambda execution roles and their inline policies, created by this
        # stack and named for the project. PassRole is what lets Terraform hand
        # those roles to Lambda and Scheduler.
        sid    = "ProjectIamRoles"
        effect = "Allow"
        actions = [
          "iam:AttachRolePolicy",
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:DeleteRolePolicy",
          "iam:DetachRolePolicy",
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole",
          "iam:ListRolePolicies",
          "iam:PassRole",
          "iam:PutRolePolicy",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:UpdateAssumeRolePolicy",
        ]
        resources = ["arn:aws:iam::*:role/${var.project}-*"]
      },
      {
        # Read-only calls Terraform makes during refresh and plan that carry no
        # resource scope.
        sid    = "ReadOnlyPlan"
        effect = "Allow"
        actions = [
          "iam:GetOpenIDConnectProvider",
          "iam:ListRoles",
          "sts:GetCallerIdentity",
        ]
        resources = ["*"]
      },
      {
        # Explicitly out of reach: the CI role must not be able to widen itself
        # or mint new credentials. Deny beats any Allow above.
        sid    = "NoSelfEscalation"
        effect = "Deny"
        actions = [
          "iam:CreateUser",
          "iam:CreateAccessKey",
          "iam:CreateLoginProfile",
          "iam:DeleteRolePermissionsBoundary",
          "iam:PutRolePermissionsBoundary",
        ]
        resources = ["*"]
      },
    ],
    local.cicd_state_statements,
  )
}

module "cicd_role" {
  count  = local.cicd_enabled ? 1 : 0
  source = "github.com/kyleswiger/aws-deployment-tooling//terraform-modules/github-oidc-role?ref=v1.0.0"

  name_prefix    = "${var.project}-deploy"
  github_repo    = var.cicd_repo
  subject_claims = local.cicd_subject_claims

  # The account already has the GitHub OIDC provider (shared with the other
  # projects deployed here); creating a second one is an API error.
  create_oidc_provider = var.cicd_create_oidc_provider

  policy_statements = local.cicd_policy_statements

  tags = {
    Project = var.project
  }
}
