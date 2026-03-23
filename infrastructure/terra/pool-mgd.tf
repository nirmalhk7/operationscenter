resource "proxmox_virtual_environment_pool" "pool-mgd" {
  pool_id = "pool-mgd"
  comment = "${local.machineSubnet}100-199"
}

resource "proxmox_virtual_environment_acl" "pool-mgd" {
  group_id = proxmox_virtual_environment_group.ug-mgd.group_id
  path     = "/pool/${proxmox_virtual_environment_pool.pool-mgd.pool_id}"
  role_id  = "PVEVMAdmin"
}