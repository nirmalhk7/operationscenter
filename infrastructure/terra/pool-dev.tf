# TODO nirmalhk7 Add to pool
# TODO nirmalhk7 Add group permissions
resource "proxmox_virtual_environment_pool" "pool-dev" {
  pool_id = "pool-dev"
  comment = "${local.machineSubnet}200-250"
  depends_on = [  ]
}