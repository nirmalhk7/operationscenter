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
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow all outbound traffic"
  }
}
