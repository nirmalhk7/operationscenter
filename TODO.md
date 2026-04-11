- [ ] Fix nfsprovisioner-subdir-external-provisioner-root:
```
Exists for 300s
Events:
  Type     Reason       Age                    From     Message
  ----     ------       ----                   ----     -------
  Warning  FailedMount  2m36s (x817 over 27h)  kubelet  MountVolume.SetUp failed for volume "pv-nfsprovisioner-nfs-subdir-external-provisioner" : mount failed: exit status 32
Mounting command: mount
Mounting arguments: -t nfs -o nfsvers=4.1 172.16.0.108:/mnt/2tbhdd /var/lib/kubelet/pods/852e4857-2636-45d6-833f-7782f24af148/volumes/kubernetes.io~nfs/pv-nfsprovisioner-nfs-subdir-external-provisioner
Output: mount: /var/lib/kubelet/pods/852e4857-2636-45d6-833f-7782f24af148/volumes/kubernetes.io~nfs/pv-nfsprovisioner-nfs-subdir-external-provisioner: fsconfig() failed: NFS: mount program didn't pass remote address.
       dmesg(1) may have more information after failed mount system call.
```
- [x] PDF viewing failing on NextCloud:
```
Framing 'https://drive.trusted.nirmalhk7.com/apps/files_pdfviewer/?file=https%3A%2F%2Fdrive.trusted.nirmalhk7.com%2Fremote.php%2Fdav%2Ffiles%2Fadmin%2FKhedkar_Nirmal_Systems_Palantir.pdf' violates the following Content Security Policy directive: "default-src 'none'". The request has been blocked. Note that 'frame-src' was not explicitly set, so 'default-src' is used as a fallback.
Understand this error
installHook.js:1 TypeError: Cannot read properties of null (reading 'getElementById')
    at r.getDownloadElement (PDFView.vue:126:1)
    at r.<anonymous> (PDFView.vue:113:1)
    at Array.<anonymous> (vue.runtime.esm.js:3159:20)
    at bs (vue.runtime.esm.js:3081:17)
overrideMethod @ installHook.js:1Understand this error
(index):1 Unsafe attempt to load URL https://drive.trusted.nirmalhk7.com/apps/files_pdfviewer/?file=https%3A%2F%2Fdrive.trusted.nirmalhk7.com%2Fremote.php%2Fdav%2Ffiles%2Fadmin%2FKhedkar_Nirmal_Systems_Palantir.pdf from frame with URL chrome-error://chromewebdata/. Domains, protocols and ports must match.
Understand this error
121?dir=/&editing=false&openfile=true:1 Refused to apply style from 'https://drive.trusted.nirmalhk7.com/apps/files_versions/css/sidebar-tab.css?v=48e0d53e-0' because its MIME type ('text/html') is not a supported stylesheet MIME type, and strict MIME checking is enabled.
```
- [ ] For Nirmal - Find LLM default credentials
- [x] Explore why Prometheus is failing on loop:
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
