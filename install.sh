#!/bin/bash
set -e

echo "=== Verifying Installations ==="
for cmd in terraform ansible kubectl kubeseal jq curl; do
	if ! command -v $cmd >/dev/null 2>&1; then
		echo "Error: $cmd is not installed."
		exit 1
	fi
done
echo "All required tools are installed."

echo "=== Verifying SSH Setup ==="
if [ ! -d ~/.ssh ]; then
    echo "Creating ~/.ssh directory..."
    mkdir -p ~/.ssh
    chmod 700 ~/.ssh
fi

if [ ! -f ~/.ssh/id_ed25519_homelab ]; then
	echo "Error: SSH key ~/.ssh/id_ed25519_homelab not found."
    echo "Please generate it or copy it over before proceeding."
	exit 1
fi
echo "SSH key found."

echo "=== Verifying Kubernetes Config Setup ==="
if [ ! -d ~/.kube ]; then
    echo "Creating ~/.kube directory..."
    mkdir -p ~/.kube
    chmod 700 ~/.kube
fi

if [ ! -f ~/.kube/config ]; then
    echo "Warning: Kubernetes config (~/.kube/config) not found."
    echo "Make sure to place your kubeconfig here if you interact with an external cluster."
else
    echo "Kubernetes config found."
fi

echo "=== User Input ==="
printf "Are you sure you want to initialize the infrastructure? (y/n): "
read confirm
echo "You entered: $confirm"
if [ "$confirm" != "y" ]; then
	echo "Initialization aborted."
	exit 1
fi
echo "Starting initialization..."
