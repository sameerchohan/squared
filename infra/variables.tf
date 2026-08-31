variable "project" {
  description = "Name prefix applied to every resource."
  type        = string
  default     = "squared"
}

variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "app_domain" {
  description = "Domain the app is served from."
  type        = string
  default     = "squared.sameerchohan.com"
}

variable "route53_zone_id" {
  description = <<-EOT
    Route 53 hosted zone for app_domain. When set, certificate validation and
    the app's DNS record are created automatically.

    Leave empty when DNS lives elsewhere — this project's domain is on
    Cloudflare — and add the two records by hand from the
    acm_validation_records and alb_dns_name outputs. Both must be "DNS only"
    in Cloudflare; see infra/README.md for why the proxied path breaks.
  EOT
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "ECR image tag to deploy. Use an immutable tag (git SHA), never 'latest'."
  type        = string
}

# ---------------------------------------------------------------------------
# Topology
#
# The NAT gateway is the single largest line item in this stack (~$32/month
# before data charges) and buys network topology rather than access control.
#
#   false — tasks run in public subnets with a public IP. Inbound is still
#           restricted by security group to the load balancer alone, so
#           nothing on the internet can reach them; the public IP only serves
#           outbound calls to Stripe and ECR.
#   true  — tasks run in private subnets and reach the internet through a NAT
#           gateway. The topology to run with real money moving through it.
#
# The database sits in private subnets either way and is never publicly
# reachable.
# ---------------------------------------------------------------------------
variable "use_nat_gateway" {
  description = "Run tasks in private subnets behind a NAT gateway (~$32/month)."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Lifecycle
#
# Production wants deletion protection, a final snapshot, and a recovery
# window on deleted secrets. A demo that is stood up, screenshotted, and torn
# down the same day wants none of those, because each one blocks or lingers
# after `terraform destroy` and quietly keeps costing money.
#
# Defaults are tuned for the ephemeral case. Set this true for anything real.
# ---------------------------------------------------------------------------
variable "enable_deletion_protection" {
  description = "Guard against accidental deletion. True for production, false for a disposable demo."
  type        = bool
  default     = false
}

variable "desired_count" {
  description = "Number of Fargate tasks. One is enough for a demo; deploys stay zero-downtime because ECS starts the replacement before draining."
  type        = number
  default     = 1
}

variable "task_cpu" {
  description = "Fargate CPU units. 256 = 0.25 vCPU."
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Fargate memory in MiB. Must be a valid pairing with task_cpu."
  type        = number
  default     = 512
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

# ---------------------------------------------------------------------------
# Automated backups
#
# Seven days is the right retention for a database holding payment records,
# and it is what this stack asks for by default. AWS accounts on the Free
# plan cannot have it: CreateDBInstance rejects the request outright with
# FreeTierRestrictionError, and no amount of planning reveals this, because
# the entitlement is only checked when the instance is actually created.
#
# It is a variable rather than a lowered default so the production value
# stays the default and a restricted account can opt down for a throwaway
# deployment.
# ---------------------------------------------------------------------------
variable "backup_retention_days" {
  description = "Days of automated RDS backups. 7 for production; Free-plan accounts must lower it."
  type        = number
  default     = 7
}

variable "enable_performance_insights" {
  description = "Requires db.t4g.medium or larger — AWS rejects it on micro/small."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Cost guardrails
# ---------------------------------------------------------------------------

variable "alert_email" {
  description = "Address that receives budget alerts."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly spend cap. Alerts fire at 80% actual and 100% forecast."
  type        = number
  default     = 40
}
