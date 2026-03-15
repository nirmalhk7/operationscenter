resource "proxmox_virtual_environment_file" "cloud_config" {
  content_type = "snippets"
  datastore_id = "local"
  node_name    = "milano"

  source_raw {
    data = <<-EOT
    #cloud-config
    package_update: true
    packages:
    - qemu-guest-agent

    # 1. Allow root login and ensure the account isn't expired/locked
    disable_root: false

    # 2. Configure SSH specifically for root
    ssh_pwauth: false
    ssh_authorized_keys:
    - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBUQs4JL0+QvvvYz1cY1Qwi/CzdQAsFFfMLgq4RXxPwY nirmalhk7@EXCALIBUR.local

    # 3. System-level commands to enforce SSH config and start agent
    runcmd:
    - systemctl enable qemu-guest-agent
    - systemctl start qemu-guest-agent
    - sed -i 's/^#PermitRootLogin.*/PermitRootLogin prohibit-password/g' /etc/ssh/sshd_config
    - systemctl restart ssh
    EOT
    file_name = "system-init.yaml"
  }
}