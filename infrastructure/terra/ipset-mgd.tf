resource "proxmox_virtual_environment_firewall_ipset" "ipset-mgd" {
  node_name = "milano"
  name    = "ipset-mgd"

  cidr {
    name    = "172.16.0.100/30"
    comment = "172.16.0.100-103"
  }

  cidr {
    name    = "172.16.0.104/29"
    comment = "172.16.0.104-111"
  }

  cidr {
    name    = "172.16.0.112/28"
    comment = "172.16.0.112-127"
  }

  cidr {
    name    = "172.16.0.128/26"
    comment = "172.16.0.128-191"
  }

  cidr {
    name    = "172.16.0.192/29"
    comment = "172.16.0.192-199"
  }
}