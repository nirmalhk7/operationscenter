# vm.tf
resource "proxmox_vm_qemu" "proxmox_vm" {
  name        = "test-vm"
  target_node = "milano"
  vmid        = 109 # Specify the VM ID here

  cores  = 2
  memory = 2048
  agent  = 1

  disk {
    size    = "32G"
    storage = "local"
    type    = "scsi"
  }

  network {
    model  = "virtio"
    bridge = "wmnet"
  }

  ipconfig0 = "ip=172.16.0.109/24,gw=172.16.0.0"
}
