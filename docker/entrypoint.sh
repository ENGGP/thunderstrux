#!/bin/sh
set -e

load_secret_file() {
  variable_name="$1"
  file_variable_name="${variable_name}_FILE"

  eval "direct_value=\${${variable_name}:-}"
  eval "secret_file=\${${file_variable_name}:-}"

  if [ -n "$direct_value" ] && [ -n "$secret_file" ]; then
    echo "Configuration error: set either ${variable_name} or ${file_variable_name}, not both." >&2
    exit 1
  fi

  if [ -z "$secret_file" ]; then
    return
  fi

  case "$secret_file" in
    /*) ;;
    *)
      echo "Configuration error: ${file_variable_name} must be an absolute path." >&2
      exit 1
      ;;
  esac

  if [ ! -f "$secret_file" ] || [ ! -r "$secret_file" ]; then
    echo "Configuration error: ${file_variable_name} is not a readable regular file." >&2
    exit 1
  fi

  secret_value="$(cat "$secret_file")"
  if [ -z "$secret_value" ]; then
    echo "Configuration error: ${file_variable_name} points to an empty secret." >&2
    exit 1
  fi

  export "${variable_name}=${secret_value}"
  unset "$file_variable_name"
}

for variable_name in \
  DATABASE_URL \
  AUTH_SECRET \
  MFA_ENCRYPTION_KEY \
  NOTIFICATION_ENCRYPTION_KEY \
  RATE_LIMIT_REDIS_URL \
  STRIPE_SECRET_KEY \
  STRIPE_WEBHOOK_SECRET \
  STRIPE_CONNECT_WEBHOOK_SECRET \
  RESEND_API_KEY
do
  load_secret_file "$variable_name"
done

exec "$@"
