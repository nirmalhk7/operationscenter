resource "proxmox_virtual_environment_pool" "pool-dev" {
  pool_id = "pool-dev"
  comment = "${local.machineSubnet}200-250"
}

resource "proxmox_virtual_environment_acl" "pool-dev" {
  group_id = proxmox_virtual_environment_group.ug-dev.group_id
  path     = "/pool/${proxmox_virtual_environment_pool.pool-dev.pool_id}"
  role_id  = "PVEVMAdmin"
}