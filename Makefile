# Makefile for operationscenter

.PHONY: encrypt reencrypt backup nginx-build nginx-logs encrypt_newkey terraform-reset terraform-apply

# --- Sealed Secrets ---
encrypt:
	@if [ -z "$(FILE)" ]; then \
		echo "Usage: make encrypt FILE=path/to/your/file.px.yaml"; \
	else \
		DIR=$$(dirname $(FILE)); \
		BASE=$$(basename $(FILE) .px.yaml); \
		kubeseal --format=yaml --cert=pub-sealed-secrets.pem < $(FILE) > $$DIR/$$BASE.yaml; \
	fi

reencrypt:
	@echo "Reencrypting all .px.yaml files in clusters directory..."
	kubeseal --fetch-cert > pub-sealed-secrets.pem
	@find clusters -type f -name "*.px.yaml" -exec echo "Processing {}" \; -exec $(MAKE) encrypt FILE={} \;
	@echo "Reencryption complete."

encrypt_newkey:
	kubeseal --fetch-cert --controller-name=sealed-secrets-controller --controller-namespace=flux-system > pub-sealed-secrets.pem



# --- Backup ---
backup_nginx:
	mkdir -p nginx.bkp
	rsync -a nginx/ nginx.bkp/
	(cd nginx.bkp && zip -r ../nginx.bkp.zip .)
	rm -rf nginx.bkp

backup_repo:
	mkdir -p repo.bkp
	cp .env repo.bkp/ || true
	rsync -a --exclude='repo.bkp' --exclude='repo.bkp.zip' ./ repo.bkp/
	zip -r repo.bkp.zip repo.bkp
	rm -rf repo.bkp

# --- Nginx ---
nginx-build:
	cp -r ~/operationscenter/nginx/* /etc/nginx/
	rc-service nginx restart

nginx-logs:
	tail -f /var/log/nginx/error.log /var/log/nginx/access.log

# --- Terraform ---
terraform-clear:
	cd infrastructure/terra && rm -rf .terraform .terraform.lock.hcl terraform.tfstate .terraform.tfstate.backup terraform.tfstate.backup

terraform-reset:
	cd infrastructure/terra && terraform state rm proxmox_lxc.testlxc || true
	cd infrastructure/terra && terraform destroy -auto-approve

terraform-apply:
	cd infrastructure/terra && terraform init -upgrade && terraform plan && terraform apply -auto-approve

# --- Ansible ---
ansible-install:
	pip install --user ansible

ansible-notebooks: ansible-install
	cd infrastructure/ansible && for nb in *.ansible.yml; do \
	  echo "Running $$nb"; \
	  ansible-playbook -i inventory.ini "$$nb"; \
	done

# --- Kubernetes ---
kubernetes-init:
# 	kubectl apply -f https://raw.githubusercontent.com/mariadb-operator/mariadb-operator/v0.20.0/deploy/crds/mariadb.mariadb.com_mariadbs.yaml
# 	kubectl apply -f https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.22/manifests/cnpg.io_clusters.yaml
# 	kubectl apply -f https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.22/manifests/cnpg.io_databases.yaml
# 	kubectl apply -f https://raw.githubusercontent.com/traefik/traefik/v2.10.4/docs/content/reference/dynamic-configuration/kubernetes-crd-definition-v1alpha1.yaml
	kubectl apply -k ./clusters/managed