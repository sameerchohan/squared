resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "${var.project}-db-subnets" }
}

# force_ssl rejects any unencrypted connection at the server, so a
# misconfigured client fails rather than sending credentials in the clear.
resource "aws_db_parameter_group" "main" {
  name_prefix = "${var.project}-pg16-"
  family      = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  db_name  = "squared"
  username = "squared"
  password = random_password.db.result

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  publicly_accessible    = false

  multi_az                = false # single-AZ to keep costs down; see README
  backup_retention_period = 7
  backup_window           = "07:00-08:00"
  maintenance_window      = "Mon:08:30-Mon:09:30"
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade = true
  deletion_protection        = var.enable_deletion_protection

  # A final snapshot is the right default for real data, but it outlives the
  # instance and keeps billing for storage, so a disposable demo skips it.
  skip_final_snapshot       = !var.enable_deletion_protection
  final_snapshot_identifier = var.enable_deletion_protection ? "${var.project}-final-snapshot" : null

  # Performance Insights is unavailable on burstable micro/small classes, so
  # it is opt-in and stays off with the default instance class.
  performance_insights_enabled    = var.enable_performance_insights
  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = { Name = "${var.project}-db" }
}
