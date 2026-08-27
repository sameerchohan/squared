# TLS certificate for the app domain. ACM certificates are free; the ALB
# cannot serve HTTPS without one, and the app's session cookie is
# Secure-flagged, so HTTP alone would break sign-in outright.

resource "aws_acm_certificate" "main" {
  domain_name       = var.app_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${var.project}-cert" }
}

# Created only when the domain's zone lives in Route 53. With DNS elsewhere,
# the records are surfaced through the acm_validation_records output and
# added by hand — see infra/README.md.
resource "aws_route53_record" "cert_validation" {
  for_each = var.route53_zone_id == "" ? {} : {
    for option in aws_acm_certificate.main.domain_validation_options :
    option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  }

  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

# Blocks until ACM observes the DNS record and issues the certificate. With
# Route 53 that resolves in a minute or two; with DNS elsewhere it waits
# while the record is added manually.
resource "aws_acm_certificate_validation" "main" {
  certificate_arn = aws_acm_certificate.main.arn

  validation_record_fqdns = var.route53_zone_id == "" ? null : [
    for record in aws_route53_record.cert_validation : record.fqdn
  ]

  timeouts {
    create = "60m"
  }
}

# Points the domain at the load balancer. Only created when Route 53 holds
# the zone; otherwise add a CNAME to the alb_dns_name output by hand.
resource "aws_route53_record" "app" {
  count = var.route53_zone_id == "" ? 0 : 1

  zone_id = var.route53_zone_id
  name    = var.app_domain
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
