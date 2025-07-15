resource "proxmox_virtual_environment_cluster_firewall_security_group" "sg-dev" {
  name    = "sg-dev"
  comment = "Dev"

  rule {
    action   = "ACCEPT"
    comment  = "Allow traffic from anywhere"
    dest     = "+dc/dev_ips"
    enabled  = true
    log      = "nolog"
    type     = "in"
  }

  rule {
    action   = "DROP"
    comment  = "Drop traffic to managed"
    dest     = "+dc/mgd_ips"
    enabled  = true
    log      = "nolog"
    source   = "+dc/dev_ips"
    type     = "out"
  }

  rule {
    action   = "ACCEPT"
    comment  = "Allow all global internet traffic"
    enabled  = true
    log      = "nolog"
    source   = "+dc/dev_ips"
    type     = "out"
  }
}