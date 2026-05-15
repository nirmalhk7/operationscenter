resource "proxmox_virtual_environment_group" "ug-dev" {
  comment  = "Dev-tier usergroup"
  group_id = "ug-dev"
}