from kubernetes import client, config
from datetime import datetime
import pytz

# Load kube config
config.load_kube_config()

# Initialize Kubernetes API clients
v1 = client.CoreV1Api()
apps_v1 = client.AppsV1Api()

# Get current time in UTC
current_time = datetime.now(pytz.utc)

# List all namespaces
namespaces = v1.list_namespace().items

for ns in namespaces:
    ns_name = ns.metadata.name
    labels = ns.metadata.labels

    if labels and 'milano.scaleDown.start' in labels and 'milano.scaleDown.end' in labels:
        start_time_str = labels['milano.scaleDown.start'].replace('.', ':')
        end_time_str = labels['milano.scaleDown.end'].replace('.', ':')
        start_time = datetime.fromisoformat(start_time_str).astimezone(pytz.utc)
        end_time = datetime.fromisoformat(end_time_str).astimezone(pytz.utc)

        if start_time <= current_time <= end_time:
            # List all deployments in the namespace
            deployments = apps_v1.list_namespaced_deployment(namespace=ns_name).items

            for deployment in deployments:
                # Scale down the deployment to 0 replicas
                body = {
                    "spec": {
                        "replicas": 0
                    }
                }
                apps_v1.patch_namespaced_deployment_scale(
                    name=deployment.metadata.name,
                    namespace=ns_name,
                    body=body
                )
                print(f"Scaled down deployment {deployment.metadata.name} in namespace {ns_name}")

print("Scaling down process completed.")