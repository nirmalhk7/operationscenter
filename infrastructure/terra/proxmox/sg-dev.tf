resource "proxmox_virtual_environment_cluster_firewall_security_group" "sg-dev" {
  name    = "sg-dev"
  comment = "Dev"

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "22"
    comment = "Allow inbound SSH"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    dest    = "+dc/ipset-dev"
    comment = "Allow traffic from anywhere"
    enabled = true
  }

  rule {
    action  = "DROP"
    source  = "+dc/ipset-dev"
    type    = "out"
    dest    = "+dc/ipset-mgd"
    comment = "Drop traffic to managed"
    log     = "info"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound DNS over UDP"
    proto   = "udp"
    dport   = "53"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound DNS over TCP"
    proto   = "tcp"
    dport   = "53"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound HTTP"
    proto   = "tcp"
    dport   = "80"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound HTTPS"
    proto   = "tcp"
    dport   = "443"
    enabled = true
  }
}
