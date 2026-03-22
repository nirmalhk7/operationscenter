# operationscenter 
[![Renovate enabled](https://img.shields.io/badge/renovate-enabled-brightgreen.svg)](https://developer.mend.io/github/nirmalhk7/operationscenter) ![Static Badge](https://img.shields.io/badge/Project-Operations%20Center-blue?link=https%3A%2F%2Fgithub.com%2Fusers%2Fnirmalhk7%2Fprojects%2F16)
 
This repository contains configurations for my home server, which I call "Operations Center" because I want to model this exactly like in a professional setting.

Currently this repository has:
- `clusters`: YAML files for all Kubernetes resources to be deployed in all clusters. Clusters would also have GitOps enabled, thanks to FluxCD.
- `nginx`: Conf files for nginx VM that sits in front of all resources.
- `charts`: Custom Helm charts for deployments.
