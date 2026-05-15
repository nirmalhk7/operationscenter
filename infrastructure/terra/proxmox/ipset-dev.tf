# resource "proxmox_virtual_environment_firewall_ipset" "ipset-dev" {
#   node_name = local.nodeName
#   name    = "ipset-dev"
#   comment = "Dev-tier IP set"

#   cidr {
#     name    = "${local.machineSubnet}200/30"
#     comment = "${local.machineSubnet}200-203"
#   }

#   cidr {
#     name    = "${local.machineSubnet}204/30"
#     comment = "${local.machineSubnet}204-207"
#   }

#   cidr {
#     name    = "${local.machineSubnet}208/28"
#     comment = "${local.machineSubnet}208-223"
#   }

#   cidr {
#     name    = "${local.machineSubnet}224/27"
#     comment = "${local.machineSubnet}224-255"
#   }
# }