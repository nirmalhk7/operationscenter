resource "proxmox_virtual_environment_group" "ug-mgd" {
  comment  = "Managed usergroup"
  group_id = "ug-mgd"
}