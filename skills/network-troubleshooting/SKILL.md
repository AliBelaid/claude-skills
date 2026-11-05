---
name: network-troubleshooting
description: Find out why a machine, server, website or app cannot be reached, layer by layer — local network, DNS, routing, port, TLS certificate, and HTTP. Covers macOS, Windows (PowerShell) and Linux servers, LAN hosts-file and certificate problems, and port conflicts. Use when someone says "the site doesn't open", "can't connect", "works on my PC but not theirs", "certificate warning", "port already in use", or asks how to test a network path. Read-only checks first.
---

# Network troubleshooting — one layer at a time

Work from the bottom up. Each layer either passes or names the next one to check. Record the
output of each check, so the answer can be verified later.

## Layers
| # | Layer | Question | Check |
|---|---|---|---|
| 1 | Local | Is this machine online and on the right network? | `ifconfig` / `ipconfig /all`; can you reach the gateway? |
| 2 | DNS | Does the name resolve to the expected IP? | `dig +short host` / `Resolve-DnsName host` |
| 3 | Route | Is there a path? | `ping host`, `traceroute host` / `Test-NetConnection host` |
| 4 | Port | Is the service listening and reachable? | `nc -vz host 443` / `Test-NetConnection host -Port 443` |
| 5 | TLS | Is the certificate valid and trusted for this name? | `openssl s_client -connect host:443 -servername host` |
| 6 | HTTP | Does the app answer correctly? | `curl -sv -o /dev/null -w "%{http_code}\n" https://host/path` |

Stop at the first layer that fails and fix that one first.

## Commands by platform
**macOS**
```bash
scutil --dns | head -40               # resolvers in use
route -n get host.example.com          # which interface would be used
lsof -nP -iTCP -sTCP:LISTEN            # what is listening on this machine
networksetup -getinfo "Wi-Fi"
```
**Windows (PowerShell)**
```powershell
Resolve-DnsName host.example.com
Test-NetConnection host.example.com -Port 443
Get-NetTCPConnection -State Listen | Select LocalPort, OwningProcess
netsh interface ipv4 show excludedportrange protocol=tcp   # ports Windows reserves
ipconfig /flushdns
Get-Content C:\Windows\System32\drivers\etc\hosts
```
**Linux server**
```bash
ss -tlnp                              # listening ports and processes
sudo ufw status verbose               # firewall
sudo journalctl -u nginx --since "1 hour ago" --no-pager | tail -50
sudo nginx -t                         # config syntax before any reload
```

## Common causes and what to check
- **Name works on one machine only:** a hosts-file entry, a DNS cache, or a different DNS server (VPN, Wi-Fi). Compare the resolved IP on both machines.
- **Certificate warning on a LAN name:** the private CA is not installed on that machine, or the certificate does not list that name. Check `openssl s_client` output for the subject and issuer.
- **Port in use or refused:** another process holds the port (`ss`, `lsof`, `Get-NetTCPConnection`). On Windows, a reserved range can block a port even when nothing is running on it; check `excludedportrange`.
- **Another web server takes port 80/443:** on Windows, IIS or HTTP.sys can own the port after a reboot, so nginx fails to bind. Check which process owns the port before changing configs.
- **Works with curl but not in a browser:** browser cache, HSTS, a proxy setting, or a cached bad certificate. Test in a private window.
- **Works inside the LAN but not outside:** NAT or port forwarding, or the firewall rule is only for the LAN subnet.

## Safety
- Diagnose only hosts the user owns or is authorised to test. Do not port-scan anything else.
- Read-only first. Do not change firewall rules, DNS, routes, or certificates without the user's approval, and say what will change before you change it.
- Keep secrets out of the output: passwords, tokens, private keys, and full connection strings.
- After a fix, re-run the failing layer and the layers above it, and report the result.

## Report format
```
Layer that failed:  <n> <name>
Evidence:           <the exact output line>
Fix applied:        <what changed, or "none, needs approval">
Verified after fix: <command and result, or "not verified">
```
