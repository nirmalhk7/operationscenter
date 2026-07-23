resource "proxmox_virtual_environment_cluster_firewall_security_group" "sg-homesecurity-lan" {
  name    = "sg-homesecurity-lan"
  comment = "HomeSecurity LAN access"

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "in"
    source  = "10.0.0.0/24"
    comment = "Allow all inbound protocols from Home LAN"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    dest    = "10.0.0.0/24"
    comment = "Allow all outbound protocols to Home LAN"
  }
}
