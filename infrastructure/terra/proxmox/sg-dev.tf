resource "proxmox_virtual_environment_cluster_firewall_security_group" "sg-dev" {
  name    = "sg-dev"
  comment = "Dev"

  # ALLOWED FROM ANY TO dev resources
  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "22"
    comment = "Allow inbound SSH"
    enabled = true
  }

  # ALLOWED FROM ANY TO dev IP set
  rule {
    action  = "ACCEPT"
    type    = "in"
    dest    = "+dc/ipset-dev"
    comment = "Allow traffic from anywhere"
    enabled = true
  }

  # ALLOWED FROM dev resources TO ANY
  rule {
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound DNS over UDP"
    proto   = "udp"
    dport   = "53"
    enabled = true
  }

  # ALLOWED FROM dev resources TO ANY
  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dport   = "53,80,443"
    comment = "Allow outbound DNS, HTTP, and HTTPS over TCP"
    enabled = true
  }

  # BLOCKED FROM dev IP set TO managed IP set
  rule {
    action  = "DROP"
    type    = "out"
    source  = "+dc/ipset-dev"
    dest    = "+dc/ipset-mgd"
    comment = "Block dev-to-managed traffic"
    log     = "info"
    enabled = true
  }

  # ALLOWED FROM dev resources TO ANY
  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow all other outbound traffic"
  }
}
