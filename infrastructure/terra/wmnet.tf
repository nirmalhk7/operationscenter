resource "proxmox_virtual_environment_network_linux_bridge" "wmnet" {
  name        = "wmnet"
  node_name   = local.nodeName
  address     = "${local.machineSubnet}0/24"
  gateway     = "${local.machineSubnet}1"
  autostart   = true
  comment     = "Main VM/LXC Intranet"
  vlan_aware  = false
}