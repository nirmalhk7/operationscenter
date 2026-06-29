# Renovate

Renovate runs as a scheduled CronJob in `mgd-devbench` and opens dependency
update pull requests against Gitea repositories.

## Bot token

Create a Gitea bot account for Renovate and generate a personal access token.
The token needs access to read repositories and write branches, pull requests,
and issues for the repositories Renovate should maintain.

From the live Gitea pod:

```sh
kubectl exec -n mgd-devbench deploy/gitea -c gitea -- \
  gitea admin user create \
    --username renovate \
    --user-type bot \
    --email renovate@trusted.nirmalhk7.com \
    --fullname "Renovate Bot"

kubectl exec -n mgd-devbench deploy/gitea -c gitea -- \
  gitea admin user generate-access-token \
    --username renovate \
    --token-name renovate \
    --scopes write:repository,write:issue,read:user \
    --raw
```

Create the ignored plaintext file from the example:

```sh
cp clusters/managed/devbench/renovate/secret.px.yaml.example \
  clusters/managed/devbench/renovate/secret.px.yaml
```

Set `RENOVATE_TOKEN`, then encrypt it:

```sh
make encrypt FILE=clusters/managed/devbench/renovate/secret.px.yaml
```

Commit the resulting `secret.yaml` and add it to
`clusters/managed/devbench/renovate/kustomization.yaml`.

## Operation

The CronJob uses Gitea autodiscovery against the same-namespace in-cluster API
endpoint `http://gitea-http:3000/api/v1`. The public
`git.trusted.nirmalhk7.com` front door includes bot protection, so do not point
Renovate at the public URL. Renovate has no public UI in this deployment; check
CronJob logs and Gitea pull requests from the Renovate bot.
