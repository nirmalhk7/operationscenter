resource "proxmox_virtual_environment_cluster_firewall_security_group" "sg-managed" {
  name    = "sg-managed"
  comment = "Managed"

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "in"
    comment = "Allow inbound SSH"
    proto   = "tcp"
    dport   = "22"
    log     = "nolog"
  }

  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    comment = "Drop connections to managed group members"
    dest    = "+dc/ipset-mgd"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    comment = "Drop outbound SSH"
    proto   = "tcp"
    dport   = "22"
    log     = "nolog"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound HTTP"
    proto   = "tcp"
    dport   = "80"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound HTTPS"
    proto   = "tcp"
    dport   = "443"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    comment = "Drop all other outbound traffic"
    log     = "info"
  }
}
