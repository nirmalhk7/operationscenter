resource "proxmox_virtual_environment_cluster_firewall_security_group" "sg-managed" {
  name    = "sg-managed"
  comment = "Managed"

  rule {
    enabled  = true
    action   = "ACCEPT"
    type     = "in"
    comment  = "Allow all inward access"
    dest     = "+dc/ipset-mgd"
    log      = "debug"
  }

  rule {
    enabled  = true
    action   = "DROP"
    type     = "in"
    comment  = "Drop packets from dev"
    source   = "+dc/ipset-dev"
    dest     = "+dc/ipset-mgd"
    log      = "debug"
  }


  rule {
    enabled  = true
    action   = "ACCEPT"
    type     = "out"
    source   = "+dc/ipset-mgd"
    comment  = "Allow outbound internet traffic"
    log      = "debug"
  }
  
  
}