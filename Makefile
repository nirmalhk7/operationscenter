encrypt:
	@if [ -z "$(FILE)" ]; then \
    	echo "Usage: make encrypt-file FILE=path/to/your/file.px.yaml"; \
	else \
    	DIR=$$(dirname $(FILE)); \
		BASE=$$(basename $(FILE) .px.yaml); \
		kubeseal --format=yaml --cert=pub-sealed-secrets.pem < $(FILE) > $$DIR/$$BASE.yaml; \
	fi

reencrypt:
	@echo "Reencrypting all .px.yaml files in clusters directory..."
	kubeseal --fetch-cert > pub-sealed-secrets.pem
	@find clusters -type f -name "*.px.yaml" -exec echo "Processing {}" \; -exec make encrypt FILE={} \;
	@echo "Reencryption complete."

backup:
	mkdir -p opcenter.bkp
	cp .env opcenter.bkp/
	find . -type f -name "*.px.yaml" -exec rsync -R \{\} opcenter.bkp/ \;
	zip -r opcenter.bkp.zip opcenter.bkp
	rm -rf opcenter.bkp

nginx_build:
	cp -r ~/operationscenter/nginx/* /etc/nginx/
	rc-service nginx restart

nginx_logs:
	tail -f /var/log/nginx/error.log && tail -f /var/log/nginx/access.log

encrypt_newkey:
	kubeseal --fetch-cert --controller-name=sealed-secrets-controller --controller-namespace=flux-system > pub-sealed-secrets.pem

terraform-reset:
	cd infrastructure/terra && terraform state rm proxmox_lxc.testlxc || true
	cd infrastructure/terra && terraform destroy -auto-approve

terraform-apply:
	cd infrastructure/terra && terraform init && terraform plan && terraform apply -auto-approve