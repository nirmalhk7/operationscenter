---
description: Add a new Kubernetes service to the managed cluster via GitOps.
---
# Workflow: Adding a Kubernetes Service

1. Create a directory in `/clusters/managed/<namespace>/<servicename>`.
2. Define the core manifests: `deployment.yaml`, `service.yaml`, and `ingress.yaml`.
3. If secret data is needed, create a `<name>.px.yaml` file with the raw Kubernetes Secret.
// turbo
4. Run `make encrypt FILE=clusters/managed/<namespace>/<servicename>/<name>.px.yaml` to generate the SealedSecret.
5. Create a `kustomization.yaml` in the directory referencing all manifests.
6. Add the new directory's path to the `resources` list in `/clusters/managed/kustomization.yaml`.
7. Summarize the changes and push to Git. FluxCD will automatically reconcile.
