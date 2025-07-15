resource "proxmox_virtual_environment_network_linux_bridge" "wmnet" {
  node_name   = "milano"
  name        = "wmnet"
  address     = "172.16.0.0/24"
  vlan_aware  = false
  autostart   = true
  comment     = "Main VM/LXC Intranet"
}