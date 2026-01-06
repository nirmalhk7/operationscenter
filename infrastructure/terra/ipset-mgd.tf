# resource "proxmox_virtual_environment_firewall_ipset" "ipset-mgd" {
#   node_name = local.nodeName
#   name    = "ipset-mgd"
#   comment = "Managed-tier IP set"

#   cidr {
#     name    = "${local.machineSubnet}100/30"
#     comment = "${local.machineSubnet}100-103"
#   }

#   cidr {
#     name    = "${local.machineSubnet}104/29"
#     comment = "${local.machineSubnet}104-111"
#   }

#   cidr {
#     name    = "${local.machineSubnet}112/28"
#     comment = "${local.machineSubnet}112-127"
#   }

#   cidr {
#     name    = "${local.machineSubnet}128/26"
#     comment = "${local.machineSubnet}128-191"
#   }

#   cidr {
#     name    = "${local.machineSubnet}192/29"
#     comment = "${local.machineSubnet}192-199"
#   }
# }