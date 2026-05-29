resource "proxmox_virtual_environment_network_linux_bridge" "wmnet" {
  name       = "wmnet"
  node_name  = local.nodeName
  address    = local.proxmoxBridgeCidr
  autostart  = true
  comment    = "Main VM/LXC Intranet"
  vlan_aware = false
}
