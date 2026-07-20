resource "proxmox_virtual_environment_cluster_firewall_security_group" "sg-managed" {
  name    = "sg-managed"
  comment = "Managed"

  # ALLOWED FROM ANY TO managed resources
  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "in"
    comment = "Allow inbound SSH"
    proto   = "tcp"
    dport   = "22"
    log     = "nolog"
  }

  # ALLOWED FROM managed resources TO ANY
  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow all outbound traffic"
  }

  # TODO BLOCK FROM managed resources TO managed resources if port is 22
}
