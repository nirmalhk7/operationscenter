resource "proxmox_virtual_environment_firewall_ipset" "ipset-dev" {
  node_name = "milano"
  name    = "ipset-dev"

  cidr {
    name    = "172.16.0.200/30"
    comment = "172.16.0.200-203"
  }

  cidr {
    name    = "172.16.0.204/30"
    comment = "172.16.0.204-207"
  }

  cidr {
    name    = "172.16.0.208/28"
    comment = "172.16.0.208-223"
  }

  cidr {
    name    = "172.16.0.224/27"
    comment = "172.16.0.224-255"
  }
}