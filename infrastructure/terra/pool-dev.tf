resource "proxmox_virtual_environment_pool" "pool-dev" {
  pool_id = "pool-dev"
  comment = "172.16.0.200-250"
}