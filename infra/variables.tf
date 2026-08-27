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
  description = "Domain the app is served from, e.g. squared.example.com."
  type        = string
}

variable "acm_certificate_arn" {
  description = "ARN of an ACM certificate covering app_domain, in this region."
  type        = string
}

variable "image_tag" {
  description = "ECR image tag to deploy. Use an immutable tag (git SHA), never 'latest'."
  type        = string
}

variable "desired_count" {
  description = "Number of Fargate tasks to run."
  type        = number
  default     = 2
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "enable_performance_insights" {
  description = "Requires db.t4g.medium or larger — AWS rejects it on micro/small."
  type        = bool
  default     = false
}
