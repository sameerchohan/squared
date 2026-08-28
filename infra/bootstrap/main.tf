# Bootstrap: identity plumbing that must outlive the application stack.
#
# Kept in its own state deliberately. The main stack is disposable — stood up,
# verified, and destroyed — while this role has to survive that cycle so CI
# keeps working. Everything here is IAM, which is free.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Separate key from the application stack: this state must survive
  # destroying that stack, since CI depends on the role it holds.
  backend "s3" {
    bucket       = "squared-tfstate-655503101368"
    key          = "bootstrap/terraform.tfstate"
    region       = "us-east-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform-bootstrap"
    }
  }
}

variable "project" {
  type    = string
  default = "squared"
}

variable "region" {
  type    = string
  default = "us-east-2"
}

variable "github_repo" {
  description = "owner/name of the repository allowed to assume the CI role."
  type        = string
  default     = "sameerchohan/squared"
}

# GitHub is migrating OIDC subject claims to an immutable form that embeds
# numeric ids — repo:owner@<ownerId>/name@<repoId>:... — so that renaming a
# repository cannot silently break a trust policy, or worse, let whoever
# claims the old name inherit it. Repositories issue one form or the other,
# and nearly every guide still documents only the legacy one.
#
# Matching on the ids with the names wildcarded is the durable choice: the
# ids never change, so a rename keeps working.
variable "github_owner_id" {
  description = "Numeric GitHub account id of the repository owner."
  type        = string
  default     = "147352814"
}

variable "github_repo_id" {
  description = "Numeric GitHub id of the repository."
  type        = string
  default     = "1347870948"
}

# ---------------------------------------------------------------------------
# GitHub Actions federation
#
# Lets workflows exchange a short-lived GitHub-signed token for AWS
# credentials. Nothing long-lived is stored in the repository: no access key,
# no secret to rotate, and no credential that keeps working if it leaks from a
# log, because the tokens expire in minutes and are bound to this repo.
# ---------------------------------------------------------------------------

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # AWS verifies GitHub's certificate chain itself; the list is still
  # required by the API, so the published intermediates are supplied.
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

data "aws_iam_policy_document" "ci_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Scoped to pull requests and pushes to main in this one repository.
    # A wildcard here would let any branch — including one pushed by a fork
    # in some configurations — assume the role.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        # Immutable form (what this repository currently issues).
        "repo:*@${var.github_owner_id}/*@${var.github_repo_id}:pull_request",
        "repo:*@${var.github_owner_id}/*@${var.github_repo_id}:ref:refs/heads/main",
        # Legacy form, kept so the role keeps working either way.
        "repo:${var.github_repo}:pull_request",
        "repo:${var.github_repo}:ref:refs/heads/main",
      ]
    }
  }
}

resource "aws_iam_role" "ci_plan" {
  name                 = "${var.project}-ci-plan"
  description          = "Read-only role assumed by GitHub Actions to run terraform plan"
  assume_role_policy   = data.aws_iam_policy_document.ci_assume.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "ci_readonly" {
  role       = aws_iam_role.ci_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# ReadOnlyAccess is broad enough to include reading secret *values*, which CI
# has no business doing. An explicit Deny overrides the Allow, so the role can
# describe secrets — which is all a plan needs — and never decrypt one.
data "aws_iam_policy_document" "deny_secret_values" {
  statement {
    effect = "Deny"
    actions = [
      "secretsmanager:GetSecretValue",
      "kms:Decrypt",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ci_deny_secret_values" {
  name   = "${var.project}-ci-deny-secret-values"
  role   = aws_iam_role.ci_plan.id
  policy = data.aws_iam_policy_document.deny_secret_values.json
}

output "ci_role_arn" {
  description = "Set as the AWS_ROLE_ARN repository variable in GitHub."
  value       = aws_iam_role.ci_plan.arn
}
