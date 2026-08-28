# Secrets live in Secrets Manager and are injected into the container by the
# ECS agent at task start. They are never written into the task definition,
# never visible in the console, and never present in the repository.

resource "random_password" "db" {
  length  = 32
  special = false # avoids escaping problems inside connection URLs
}

resource "aws_secretsmanager_secret" "db_password" {
  name                    = "${var.project}/db-password"
  description             = "Master password for the Squared RDS instance"
  recovery_window_in_days = var.enable_deletion_protection ? 7 : 0
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = random_password.db.result
}

# The full connection string, assembled once so the application receives a
# single DATABASE_URL rather than reassembling credentials at runtime.
resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${var.project}/database-url"
  description             = "Postgres connection string"
  recovery_window_in_days = var.enable_deletion_protection ? 7 : 0
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "postgresql://%s:%s@%s:%s/%s",
    aws_db_instance.main.username,
    random_password.db.result,
    aws_db_instance.main.address,
    aws_db_instance.main.port,
    aws_db_instance.main.db_name,
  )
}

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "${var.project}/jwt-secret"
  description             = "Signing key for session JWTs"
  recovery_window_in_days = var.enable_deletion_protection ? 7 : 0
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt.result
}

# Stripe credentials are created empty and populated out of band, so live
# keys never pass through Terraform state:
#
#   aws secretsmanager put-secret-value \
#     --secret-id squared/stripe-secret-key --secret-string 'sk_live_...'
#   aws secretsmanager put-secret-value \
#     --secret-id squared/stripe-webhook-secret --secret-string 'whsec_...'
resource "aws_secretsmanager_secret" "stripe_secret_key" {
  name                    = "${var.project}/stripe-secret-key"
  description             = "Stripe secret API key — set out of band"
  recovery_window_in_days = var.enable_deletion_protection ? 7 : 0
}

resource "aws_secretsmanager_secret" "stripe_webhook_secret" {
  name                    = "${var.project}/stripe-webhook-secret"
  description             = "Stripe webhook signing secret — set out of band"
  recovery_window_in_days = var.enable_deletion_protection ? 7 : 0
}
