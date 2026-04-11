- [ ] Fix nfsprovisioner-subdir-external-provisioner-root (NFS mount options update pending)
```
...
```
- [ ] PDF viewing failing on NextCloud:
...
- [x] For Nirmal - Find LLM default credentials (Found: Open-WebUI uses local auth; first user to register is admin. Common default: admin/admin)
- [ ] Explore why Prometheus is failing on loop:

```
time=2026-04-10T02:02:19.718Z level=WARN source=main.go:1137 msg="Received an OS signal, exiting gracefully..." signal=terminated
time=2026-04-10T02:02:19.718Z level=INFO source=main.go:1162 msg="Stopping scrape discovery manager..."
time=2026-04-10T02:02:19.718Z level=INFO source=main.go:1176 msg="Stopping notify discovery manager..."
time=2026-04-10T02:02:19.718Z level=INFO source=manager.go:216 msg="Stopping rule manager..." component="rule manager"
time=2026-04-10T02:02:19.719Z level=INFO source=main.go:1158 msg="Scrape discovery manager stopped"
time=2026-04-10T02:02:19.724Z level=INFO source=main.go:1172 msg="Notify discovery manager stopped"
time=2026-04-10T02:02:19.725Z level=INFO source=manager.go:232 msg="Rule manager stopped" component="rule manager"
time=2026-04-10T02:02:19.725Z level=INFO source=main.go:1213 msg="Stopping scrape manager..."
time=2026-04-10T02:02:19.725Z level=INFO source=main.go:1205 msg="Scrape manager stopped"
time=2026-04-10T02:02:19.730Z level=INFO source=manager.go:321 msg="Stopping notification manager..." component=notifier
time=2026-04-10T02:02:19.730Z level=INFO source=main.go:1488 msg="Notifier manager stopped"
time=2026-04-10T02:02:19.730Z level=INFO source=main.go:1502 msg="See you next time!"
```
