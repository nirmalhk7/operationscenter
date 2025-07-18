# TODO nirmalhk7 Add to pool
# TODO nirmalhk7 Add group permissions
resource "proxmox_virtual_environment_pool" "pool-mgd" {
  pool_id = "pool-mgd"
  comment = "${local.machineSubnet}100-199"
  depends_on = [ proxmox_virtual_environment_container.lxc-tailscale ]
}