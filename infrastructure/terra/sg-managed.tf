resource "proxmox_virtual_environment_cluster_firewall_security_group" "sg-managed" {
  name    = "sg-managed"
  comment = "Managed"

  rule {
    action   = "ACCEPT"
    comment  = "SSH access"
    dest     = "+dc/mgd_ips"
    dport    = "22"
    enabled  = true
    log      = "nolog"
    proto    = "tcp"
    type     = "in"
  }

  rule {
    action   = "ACCEPT"
    comment  = "Allow intra-group traffic"
    dest     = "+dc/mgd_ips"
    enabled  = true
    log      = "nolog"
    source   = "+dc/mgd_ips"
    type     = "in"
  }

  rule {
    action   = "DROP"
    comment  = "Drop all other traffic"
    dest     = "+dc/mgd_ips"
    enabled  = true
    log      = "nolog"
    type     = "in"
  }

  rule {
    action   = "ACCEPT"
    comment  = "Allow global/dev internet traffic"
    enabled  = true
    log      = "nolog"
    source   = "+dc/mgd_ips"
    type     = "out"
  }
}