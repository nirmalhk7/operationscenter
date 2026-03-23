#!/usr/bin/env bash
set -e

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <telegram_bot_token> <chat_id>"
  echo "Example: $0 1234567890:AAH... -1001234567890"
  exit 1
fi

TOKEN="$1"
CHAT_ID="$2"

PROVIDER_FILE="clusters/managed/flux-system/notify-telegram/provider.yaml"
SECRET_PX_FILE="clusters/managed/flux-system/notify-telegram/secret.px.yaml"
SECRET_FILE="clusters/managed/flux-system/notify-telegram/secret.yaml"

if [ ! -f "$PROVIDER_FILE" ]; then
  echo "Error: $PROVIDER_FILE not found. Are you running this from the repository root?"
  exit 1
fi

echo "Updating $PROVIDER_FILE with chat ID: $CHAT_ID..."
sed -i "s/channel: \".*\"/channel: \"$CHAT_ID\"/" "$PROVIDER_FILE"

echo "Creating plain text secret file $SECRET_PX_FILE..."
cat <<EOF > "$SECRET_PX_FILE"
apiVersion: v1
kind: Secret
metadata:
  name: telegram-token
  namespace: flux-system
type: Opaque
stringData:
  token: "$TOKEN"
EOF

echo "Encrypting secret using kubeseal..."
make encrypt FILE="$SECRET_PX_FILE"

echo "Done! Commit and push $PROVIDER_FILE and $SECRET_FILE to apply the changes."
echo "Do not commit $SECRET_PX_FILE."
