output "alb_dns_name" {
  description = "Point the app_domain DNS record at this."
  value       = aws_lb.main.dns_name
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

output "private_subnet_ids" {
  description = "Needed when invoking the migration task from the CLI."
  value       = aws_subnet.private[*].id
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
