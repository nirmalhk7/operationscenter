# Nginx Configuration for Trusted Subdomains

This project contains Nginx configuration files for reverse proxying to various subdomains under the trusted.nirmalhk7.com domain. The main configuration file is located at `nginx-config/nginx.conf`, which includes global settings and directives.

## Directory Structure

- `nginx-config/`
  - `nginx.conf`: Main Nginx configuration file.
  - `conf.d/`
    - `grafana.conf`: Configuration for the Grafana subdomain.
    - `dev.conf`: Configuration for the development subdomain.
    - `other-subdomains.conf`: Configuration for additional subdomains.

## Setup Instructions

1. **Install Nginx**: Ensure that Nginx is installed on your server. You can install it using your package manager (e.g., `apt`, `yum`, `brew`).

2. **Copy Configuration Files**: Place the contents of this project into your Nginx configuration directory, typically located at `/etc/nginx/`.

3. **Include Configuration**: Ensure that your `nginx.conf` file includes the `conf.d` directory. This is usually done with the following line:
   ```
   include /etc/nginx/conf.d/*.conf;
   ```

4. **Test Configuration**: Before starting Nginx, test the configuration for any syntax errors:
   ```
   nginx -t
   ```

5. **Start Nginx**: If the configuration test is successful, start or restart Nginx:
   ```
   systemctl restart nginx
   ```

## Security Best Practices

- **Use HTTPS**: It is highly recommended to secure your subdomains with SSL/TLS. Consider using Let's Encrypt for free SSL certificates.
- **Limit Access**: Use firewall rules to restrict access to your services based on IP addresses if applicable.
- **Regular Updates**: Keep your Nginx and services updated to protect against vulnerabilities.
- **Monitor Logs**: Regularly check Nginx access and error logs for any suspicious activity.

## Additional Notes

- Each subdomain configuration file should be tailored to the specific service it proxies to, ensuring that headers and security settings are appropriately configured.
- For more advanced configurations, refer to the [Nginx documentation](https://nginx.org/en/docs/).