resource "proxmox_virtual_environment_cluster_firewall_security_group" "sg-dev" {
  name    = "sg-dev"
  comment = "Dev"

  rule {
    action   = "ACCEPT"
    type     = "in"
    dest     = "+dc/ipset-dev"
    comment  = "Allow traffic from anywhere"
    log      = "nolog"
    enabled  = true
  }

  rule {
    action   = "DROP"
    source   = "+dc/ipset-dev"
    type     = "out"
    dest     = "+dc/ipset-mgd"
    comment  = "Drop traffic to managed"
    log      = "info"
    enabled  = true
  }
}