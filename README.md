# operationscenter 
[![Renovate enabled](https://img.shields.io/badge/renovate-enabled-brightgreen.svg)](https://developer.mend.io/github/nirmalhk7/operationscenter) ![Static Badge](https://img.shields.io/badge/Project-Operations%20Center-blue?link=https%3A%2F%2Fgithub.com%2Fusers%2Fnirmalhk7%2Fprojects%2F16)
 

https://img.shields.io/badge/any%20text-you%20like-blue

This repository contains configurations for my home server, which I call "Operations Center" because I want to model this exactly like in a professional setting.

Currently this repository has:
- `clusters`: YAML files for all Kubernetes resources to be deployed in all clusters. Clusters would also have GitOps enabled, thanks to FluxCD.
- `nginx`: Conf files for nginx VM that sits in front of all resources.
- `charts`: Custom Helm charts for deployments.

## Flux Development

If you are developing locally and want to make changes to the cluster manually without Flux overriding them, you can suspend the main Kustomization syncing using the following Makefile targets:

```bash
make flux-suspend
make flux-resume
```

### Configuring Telegram Notifications

Flux is configured to send notifications to Telegram for any changes made to the Git repository, Kustomizations, Helm releases, and Helm repositories.
To route these notifications to your group chat:

1. Create a Telegram Bot and add it to your group chat.
2. Obtain the **Bot Token** from BotFather.
3. Obtain the **Chat ID** of your group chat (usually a negative number).
4. Run the configuration script to automatically update the provider configuration and encrypt the token using `kubeseal`:

```bash
./scripts/configure-telegram.sh <bot_token> <chat_id>
```

5. Commit and push the updated `provider.yaml` and `secret.yaml`. Do NOT commit the `secret.px.yaml` file containing the plain text token.
