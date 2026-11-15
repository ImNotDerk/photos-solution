import AppKit
import Foundation

// Structure matching ~/.photo-triage/config.json
struct PhotoTriageConfig: Codable {
    var hardDriveRoot: String?
    var folderFormat: String?
    var deviceName: String?
}

struct FolderPreset {
    let id: String
    let label: String
    let template: String
    let example: String
}

let folderPresets: [FolderPreset] = [
    FolderPreset(id: "year_month_name", label: "Year / Month Name", template: "{YYYY}/{MONTH}", example: "2026/NOVEMBER"),
    FolderPreset(id: "year_month_num", label: "Year / Numeric Month", template: "{YYYY}/{MM}", example: "2026/11"),
    FolderPreset(id: "year_month_dash", label: "Year-Month Combined", template: "{YYYY}-{MM}", example: "2026-11"),
    FolderPreset(id: "device_year_month", label: "Device / Year / Month", template: "{DEVICE}/{YYYY}/{MONTH}", example: "iPhone/2026/NOVEMBER"),
    FolderPreset(id: "year_only", label: "Year Only", template: "{YYYY}", example: "2026"),
]

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var statusMenu: NSMenu!
    private var healthTimer: Timer?
    private var isOnline: Bool = false
    private var hardDriveRoot: String = "/Volumes/Media Drive"
    private var folderFormat: String = "{YYYY}/{MONTH}"
    private var lanIpAddress: String = "127.0.0.1"
    private var serverProcess: Process?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Setup Menu Bar Item
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            if let img = NSImage(systemSymbolName: "externaldrive.badge.wifi", accessibilityDescription: "Photo Triage") {
                img.isTemplate = true
                button.image = img
            } else if let fallback = NSImage(systemSymbolName: "photo.stack", accessibilityDescription: "Photo Triage") {
                fallback.isTemplate = true
                button.image = fallback
            } else {
                button.title = "Photo Triage"
            }
        }

        loadConfigFile()
        detectLanIp()
        rebuildMenu()

        // Health check immediately, then every 3 seconds
        checkServerHealth()
        healthTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.checkServerHealth()
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        healthTimer?.invalidate()
        if let proc = serverProcess, proc.isRunning {
            proc.terminate()
        }
    }

    // MARK: - Configuration I/O

    private var configDirectory: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".photo-triage", isDirectory: true)
    }

    private var configFileURL: URL {
        return configDirectory.appendingPathComponent("config.json")
    }

    private func loadConfigFile() {
        let file = configFileURL
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        do {
            let data = try Data(contentsOf: file)
            let decoded = try JSONDecoder().decode(PhotoTriageConfig.self, from: data)
            if let root = decoded.hardDriveRoot, !root.isEmpty {
                self.hardDriveRoot = root
            }
            if let fmt = decoded.folderFormat, !fmt.isEmpty {
                self.folderFormat = fmt
            }
        } catch {
            print("[Menu Bar] Could not read config file: \(error.localizedDescription)")
        }
    }

    private func saveConfigFile() {
        let dir = configDirectory
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let cfg = PhotoTriageConfig(hardDriveRoot: hardDriveRoot, folderFormat: folderFormat, deviceName: "iPhone")
            let encoder = JSONEncoder()
            encoder.outputFormatting = .prettyPrinted
            let data = try encoder.encode(cfg)
            try data.write(to: configFileURL)
        } catch {
            print("[Menu Bar] Failed to save config: \(error.localizedDescription)")
        }
    }

    private func pushConfigToServer() {
        guard let url = URL(string: "http://localhost:3000/api/config") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload: [String: String] = [
            "hardDriveRoot": hardDriveRoot,
            "folderFormat": folderFormat,
            "deviceName": "iPhone"
        ]

        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }
        req.httpBody = body

        URLSession.shared.dataTask(with: req) { _, _, _ in }.resume()
    }

    // MARK: - LAN IP Detection

    private func detectLanIp() {
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let firstAddr = ifaddr else { return }
        defer { freeifaddrs(ifaddr) }

        for ptr in sequence(first: firstAddr, next: { $0.pointee.ifa_next }) {
            guard let ifaAddr = ptr.pointee.ifa_addr else { continue }
            let flags = Int32(ptr.pointee.ifa_flags)
            let addr = ifaAddr.pointee

            if (flags & (IFF_UP | IFF_RUNNING)) != 0 && (flags & IFF_LOOPBACK) == 0 {
                if addr.sa_family == UInt8(AF_INET) {
                    var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    let name = String(cString: ptr.pointee.ifa_name)
                    if getnameinfo(ifaAddr, socklen_t(ifaAddr.pointee.sa_len),
                                   &hostname, socklen_t(hostname.count),
                                   nil, 0, NI_NUMERICHOST) == 0 {
                        let ip = hostname.withUnsafeBufferPointer { buf in
                            String(cString: buf.baseAddress!)
                        }
                        if name.hasPrefix("en") || name.hasPrefix("eth") {
                            self.lanIpAddress = ip
                            return
                        }
                    }
                }
            }
        }
    }

    // MARK: - Server Health Check

    private func checkServerHealth() {
        guard let url = URL(string: "http://localhost:3000/api/session") else { return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 2.0

        let task = URLSession.shared.dataTask(with: req) { [weak self] data, response, error in
            let online = (error == nil && (response as? HTTPURLResponse)?.statusCode == 200)

            Task { @MainActor in
                guard let self = self else { return }
                if self.isOnline != online {
                    self.isOnline = online
                    self.rebuildMenu()
                }

                // If online, optionally sync state from server
                if online, let data = data,
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let remoteDrive = json["hardDriveRoot"] as? String, !remoteDrive.isEmpty {
                    if self.hardDriveRoot != remoteDrive {
                        self.hardDriveRoot = remoteDrive
                        self.rebuildMenu()
                    }
                }
            }
        }
        task.resume()
    }

    // MARK: - Menu Construction

    private func rebuildMenu() {
        let menu = NSMenu()

        // 1. Title / Status Line
        let statusTitle = isOnline
            ? "Photo Triage: Online (Port 3000)"
            : "Photo Triage: Offline"
        let statusMenuItem = NSMenuItem(title: statusTitle, action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)

        // 2. Backup Destination Root
        let driveName = (hardDriveRoot as NSString).lastPathComponent
        let driveTitle = "Destination: \(driveName.isEmpty ? hardDriveRoot : driveName)"
        let driveMenuItem = NSMenuItem(title: driveTitle, action: nil, keyEquivalent: "")
        driveMenuItem.toolTip = hardDriveRoot
        driveMenuItem.isEnabled = false
        menu.addItem(driveMenuItem)

        menu.addItem(NSMenuItem.separator())

        // 3. Choose Backup Folder in Finder
        let chooseItem = NSMenuItem(
            title: "Choose Backup Folder in Finder...",
            action: #selector(handleChooseFolder),
            keyEquivalent: "o"
        )
        chooseItem.target = self
        menu.addItem(chooseItem)

        // 4. Folder Hierarchy Preset Submenu
        let presetsMenuItem = NSMenuItem(title: "Folder Hierarchy Preset", action: nil, keyEquivalent: "")
        let presetsSubmenu = NSMenu()

        for preset in folderPresets {
            let item = NSMenuItem(
                title: "\(preset.label) (\(preset.example))",
                action: #selector(handleSelectPreset(_:)),
                keyEquivalent: ""
            )
            item.target = self
            item.representedObject = preset.template
            if preset.template == folderFormat {
                item.state = .on
            }
            presetsSubmenu.addItem(item)
        }
        presetsMenuItem.submenu = presetsSubmenu
        menu.addItem(presetsMenuItem)

        menu.addItem(NSMenuItem.separator())

        // 5. Open Web Dashboard
        let dashboardItem = NSMenuItem(
            title: "Open Web Dashboard",
            action: #selector(handleOpenDashboard),
            keyEquivalent: "d"
        )
        dashboardItem.target = self
        dashboardItem.isEnabled = isOnline
        menu.addItem(dashboardItem)

        // 6. Copy iPhone URLs
        let copyWifiItem = NSMenuItem(
            title: "Copy iPhone URL (Wi-Fi): http://\(lanIpAddress):3000",
            action: #selector(handleCopyWifiUrl),
            keyEquivalent: ""
        )
        copyWifiItem.target = self
        menu.addItem(copyWifiItem)

        let copyUsbItem = NSMenuItem(
            title: "Copy iPhone URL (USB Cable): http://172.20.10.2:3000",
            action: #selector(handleCopyUsbUrl),
            keyEquivalent: ""
        )
        copyUsbItem.target = self
        menu.addItem(copyUsbItem)

        menu.addItem(NSMenuItem.separator())

        // 7. Server Process Controls
        if isOnline {
            let restartItem = NSMenuItem(
                title: "Restart Server",
                action: #selector(handleRestartServer),
                keyEquivalent: "r"
            )
            restartItem.target = self
            menu.addItem(restartItem)

            let stopItem = NSMenuItem(
                title: "Stop Server",
                action: #selector(handleStopServer),
                keyEquivalent: "s"
            )
            stopItem.target = self
            menu.addItem(stopItem)
        } else {
            let startItem = NSMenuItem(
                title: "Start Server",
                action: #selector(handleStartServer),
                keyEquivalent: "s"
            )
            startItem.target = self
            menu.addItem(startItem)
        }

        menu.addItem(NSMenuItem.separator())

        // 8. Quit
        let quitItem = NSMenuItem(
            title: "Quit Photo Triage",
            action: #selector(handleQuit),
            keyEquivalent: "q"
        )
        quitItem.target = self
        menu.addItem(quitItem)

        statusMenu = menu
        statusItem.menu = statusMenu
    }

    // MARK: - Actions

    @objc private func handleChooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = "Select Backup Folder"
        panel.message = "Choose destination folder for verified photo backups:"

        NSApp.activate(ignoringOtherApps: true)
        if panel.runModal() == .OK, let selectedUrl = panel.url {
            let chosen = selectedUrl.path
            self.hardDriveRoot = chosen
            saveConfigFile()
            pushConfigToServer()
            rebuildMenu()
        }
    }

    @objc private func handleSelectPreset(_ sender: NSMenuItem) {
        guard let template = sender.representedObject as? String else { return }
        self.folderFormat = template
        saveConfigFile()
        pushConfigToServer()
        rebuildMenu()
    }

    @objc private func handleOpenDashboard() {
        if let url = URL(string: "http://localhost:3000") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func handleCopyWifiUrl() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString("http://\(lanIpAddress):3000", forType: .string)
    }

    @objc private func handleCopyUsbUrl() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString("http://172.20.10.2:3000", forType: .string)
    }

    @objc private func handleStartServer() {
        let repoRoot = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().path
        let scriptPath = (repoRoot as NSString).appendingPathComponent("Start Photo Triage.command")

        if FileManager.default.fileExists(atPath: scriptPath) {
            let url = URL(fileURLWithPath: scriptPath)
            NSWorkspace.shared.open(url)
        } else {
            // Fallback: spawn node directly
            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            proc.arguments = ["npm", "start"]
            proc.currentDirectoryURL = URL(fileURLWithPath: repoRoot)
            try? proc.run()
            self.serverProcess = proc
        }
        rebuildMenu()
    }

    @objc private func handleRestartServer() {
        handleStopServer()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.handleStartServer()
        }
    }

    @objc private func handleStopServer() {
        if let proc = serverProcess, proc.isRunning {
            proc.terminate()
            serverProcess = nil
        }
        // Send graceful SIGTERM to port 3000 process
        let killProc = Process()
        killProc.executableURL = URL(fileURLWithPath: "/bin/sh")
        killProc.arguments = ["-c", "lsof -ti :3000 | xargs kill -15 2>/dev/null || true"]
        try? killProc.run()
        killProc.waitUntilExit()

        self.isOnline = false
        rebuildMenu()
    }

    @objc private func handleQuit() {
        NSApp.terminate(nil)
    }
}

// Entry point
@main
struct PhotoTriageMenuBarApp {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}
