output "app_url" {
  description = "Where the app is served once DNS resolves."
  value       = "https://${var.app_domain}"
}

output "alb_dns_name" {
  description = "Point app_domain at this if the zone is not in Route 53."
  value       = aws_lb.main.dns_name
}

output "acm_validation_records" {
  description = <<-EOT
    DNS records proving domain ownership. Empty when route53_zone_id is set,
    because the records are created automatically.
  EOT
  value = var.route53_zone_id != "" ? [] : [
    for option in aws_acm_certificate.main.domain_validation_options : {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  ]
}

output "ecr_repository_url" {
  description = "Push application images here."
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_definition" {
  description = "Run this task before rolling out a new revision."
  value       = aws_ecs_task_definition.migrate.family
}

output "task_subnet_ids" {
  description = "Subnets the tasks run in — needed when invoking the migration task."
  value       = local.task_subnet_ids
}

output "task_assign_public_ip" {
  description = "Whether the migration task needs a public IP (true without a NAT gateway)."
  value       = local.task_public_ip
}

output "app_security_group_id" {
  value = aws_security_group.app.id
}

output "db_endpoint" {
  description = "RDS endpoint (private; reachable only from inside the VPC)."
  value       = aws_db_instance.main.address
}

output "webhook_endpoint" {
  description = "Register this URL in the Stripe dashboard."
  value       = "https://${var.app_domain}/api/stripe/webhook"
}

output "run_migration_command" {
  description = "Copy-paste command that applies migrations before a rollout."
  value = join(" ", [
    "aws ecs run-task",
    "--cluster ${aws_ecs_cluster.main.name}",
    "--task-definition ${aws_ecs_task_definition.migrate.family}",
    "--launch-type FARGATE",
    "--network-configuration 'awsvpcConfiguration={subnets=[${join(",", local.task_subnet_ids)}],securityGroups=[${aws_security_group.app.id}],assignPublicIp=${local.task_public_ip ? "ENABLED" : "DISABLED"}}'",
  ])
}
