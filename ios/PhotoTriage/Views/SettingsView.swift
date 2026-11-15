import SwiftUI

/// Settings Icon Badge in authentic Apple iOS Settings style
public struct SettingsIconBadge: View {
    public let icon: String
    public let color: Color

    public init(icon: String, color: Color) {
        self.icon = icon
        self.color = color
    }

    public var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(color)
                .frame(width: 30, height: 30)

            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
        }
    }
}

/// Apple HIG Inset Grouped Settings View
/// Allows configuring the Mac backup server URL, testing local network reachability,
/// inspecting external hard drive mount status, and reviewing safety invariants.
public struct SettingsView: View {
    @EnvironmentObject public var networkManager: NetworkManager

    @State private var inputUrl: String = ""
    @State private var isPinging: Bool = false
    @State private var isAutoDetecting: Bool = false
    @State private var pingResult: String? = nil
    @State private var sessionStatus: ServerSessionStatus? = nil
    @State private var statusError: String? = nil

    @AppStorage("isAdvancedModeEnabled") private var isAdvancedModeEnabled: Bool = false

    public init() {}

    public var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header Bar
                headerBar

                // Inset Grouped Content
                ScrollView {
                    VStack(spacing: 18) {
                        // Server Endpoint Configuration Card
                        serverConfigCard

                        // Live Diagnostics Card
                        diagnosticsCard

                        // Display & Interface Preferences
                        displayPreferencesCard

                        // System Architecture & Safety Invariants Card
                        safetyGuaranteesCard

                        // Build & Engine Info
                        systemInfoCard
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                }
            }
        }
        .onAppear {
            inputUrl = networkManager.serverUrl
        }
    }

    // MARK: - Header Bar

    private var headerBar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("SETTINGS")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(.white)

                    Text("CONFIGURATION & SERVER HEALTH")
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.5))
                }

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 10)

            Rectangle()
                .fill(Color.white.opacity(0.12))
                .frame(height: 0.5)
        }
        .background(Color(red: 0.08, green: 0.08, blue: 0.09).opacity(0.95))
    }

    // MARK: - Server Configuration Card

    private var serverConfigCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("MAC BACKUP SERVER HOST")
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundColor(.white.opacity(0.6))
                .padding(.horizontal, 4)

            VStack(spacing: 0) {
                // Input Field Row
                HStack(spacing: 12) {
                    SettingsIconBadge(icon: "network", color: .blue)

                    TextField("http://10.142.1.127:3000", text: $inputUrl)
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundColor(.white)
                        #if canImport(UIKit)
                        .autocapitalization(.none)
                        .keyboardType(.URL)
                        .disableAutocorrection(true)
                        #endif
                        .onSubmit {
                            saveUrl()
                        }

                    if !inputUrl.isEmpty {
                        Button {
                            inputUrl = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 14))
                                .foregroundColor(.white.opacity(0.3))
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)

                Rectangle()
                    .fill(Color.white.opacity(0.1))
                    .frame(height: 0.5)

                // Quick Action Bar (Auto-Detect & Reset)
                HStack(spacing: 10) {
                    Button {
                        triggerHapticFeedback(1)
                        runAutoDetect()
                    } label: {
                        HStack(spacing: 5) {
                            if isAutoDetecting {
                                ProgressView()
                                    .scaleEffect(0.6)
                                    .tint(.white)
                            } else {
                                Image(systemName: "bolt.fill")
                                    .font(.system(size: 11))
                            }
                            Text(isAutoDetecting ? "DETECTING..." : "AUTO-DETECT")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                        }
                        .foregroundColor(.blue)
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                        .background(Color.blue.opacity(0.15))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .disabled(isAutoDetecting)

                    Button {
                        triggerHapticFeedback(0)
                        inputUrl = NetworkManager.defaultServerUrl
                        saveUrl()
                    } label: {
                        Text("DEFAULT")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundColor(.white.opacity(0.8))
                            .frame(maxWidth: .infinity)
                            .frame(height: 36)
                            .background(Color.white.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)

                Rectangle()
                    .fill(Color.white.opacity(0.1))
                    .frame(height: 0.5)

                // Test Connection Button
                Button {
                    triggerHapticFeedback(1)
                    saveUrl()
                    runDiagnostics()
                } label: {
                    HStack(spacing: 6) {
                        if isPinging {
                            ProgressView()
                                .scaleEffect(0.7)
                                .tint(.white)
                        } else {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.system(size: 13, weight: .semibold))
                        }
                        Text(isPinging ? "TESTING CONNECTION..." : "TEST CONNECTION")
                            .font(.system(size: 13, weight: .bold, design: .monospaced))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 42)
                    .background(Color.blue)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .disabled(isPinging)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }
            .background(Color(red: 0.11, green: 0.11, blue: 0.12))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private func saveUrl() {
        let cleaned = NetworkManager.sanitizeUrl(inputUrl)
        inputUrl = cleaned
        networkManager.setServerUrl(cleaned)
    }

    // MARK: - Diagnostics Card

    private var hardDriveStatusInfo: (text: String, color: Color) {
        if let status = sessionStatus {
            if status.hardDriveMounted == true {
                let path = status.hardDriveRoot ?? "/Volumes/PhotosHD"
                return ("MOUNTED (\(path))", Color.triageBackupKeep)
            } else {
                return ("UNMOUNTED (Drive not detected on Mac)", Color.triageTrash)
            }
        } else {
            return ("UNKNOWN (Run connection test)", Color.white.opacity(0.5))
        }
    }

    private var diagnosticsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("LIVE SERVER DIAGNOSTICS")
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundColor(.white.opacity(0.6))
                .padding(.horizontal, 4)

            VStack(spacing: 0) {
                // Reachability Row
                HStack(spacing: 12) {
                    SettingsIconBadge(icon: "antenna.radiowaves.left.and.right", color: networkManager.isReachable ? .green : .red)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("SERVER REACHABILITY")
                            .font(.system(size: 13, weight: .semibold, design: .monospaced))
                            .foregroundColor(.white)

                        Text(networkManager.isReachable ? "ONLINE (HTTP 200)" : "OFFLINE / UNREACHABLE")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(networkManager.isReachable ? .triageBackupKeep : .triageTrash)
                    }

                    Spacer()

                    Circle()
                        .fill(networkManager.isReachable ? Color.triageBackupKeep : Color.triageTrash)
                        .frame(width: 8, height: 8)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)

                Rectangle()
                    .fill(Color.white.opacity(0.1))
                    .frame(height: 0.5)

                // External Hard Drive Row
                HStack(spacing: 12) {
                    SettingsIconBadge(icon: "externaldrive.fill", color: .orange)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("EXTERNAL HARD DRIVE")
                            .font(.system(size: 13, weight: .semibold, design: .monospaced))
                            .foregroundColor(.white)

                        Text(hardDriveStatusInfo.text)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(hardDriveStatusInfo.color)
                    }

                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)

                if let result = pingResult {
                    Rectangle()
                        .fill(Color.white.opacity(0.1))
                        .frame(height: 0.5)

                    HStack(spacing: 12) {
                        SettingsIconBadge(icon: "doc.text.magnifyingglass", color: .cyan)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("DIAGNOSTIC LOG")
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .foregroundColor(.white.opacity(0.6))

                            Text(result)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(.white.opacity(0.9))
                        }

                        Spacer()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                }

                if let err = statusError {
                    Rectangle()
                        .fill(Color.white.opacity(0.1))
                        .frame(height: 0.5)

                    HStack(spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.triageTrash)
                            .font(.system(size: 13))

                        Text("[ERROR] \(err)")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.triageTrash)

                        Spacer()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                }
            }
            .background(Color(red: 0.11, green: 0.11, blue: 0.12))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private func runDiagnostics() {
        guard !isPinging else { return }
        isPinging = true
        statusError = nil
        pingResult = nil

        Task {
            let start = Date()
            let reachable = await networkManager.pingServer()
            let elapsed = Int(Date().timeIntervalSince(start) * 1000)

            if reachable {
                pingResult = "Handshake OK (\(elapsed)ms)"
                do {
                    let status = try await networkManager.fetchSessionStatus()
                    self.sessionStatus = status
                } catch {
                    self.statusError = error.localizedDescription
                }
            } else {
                pingResult = "Failed to connect after \(elapsed)ms"
                self.sessionStatus = nil
            }
            isPinging = false
        }
    }

    private func runAutoDetect() {
        guard !isAutoDetecting else { return }
        isAutoDetecting = true
        pingResult = nil
        statusError = nil

        Task {
            if let detected = await networkManager.autoDetectServer() {
                inputUrl = detected
                saveUrl()
                runDiagnostics()
                triggerHapticFeedback(1)
            } else {
                pingResult = "FAILED: No server detected on USB (172.20.10.2) or local network."
                triggerHapticFeedback(2)
            }
            isAutoDetecting = false
        }
    }

    // MARK: - Display Preferences Card

    private var displayPreferencesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("DISPLAY & INTERFACE")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.white.opacity(0.6))
                .padding(.horizontal, 4)

            VStack(spacing: 0) {
                Toggle(isOn: $isAdvancedModeEnabled) {
                    HStack(spacing: 12) {
                        SettingsIconBadge(icon: "slider.horizontal.3", color: .purple)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("ADVANCED TELEMETRY")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(.white)

                            Text("Show resolution, codec, destination path, and file size badges")
                                .font(.system(size: 11))
                                .foregroundColor(.white.opacity(0.5))
                        }
                    }
                }
                .tint(.blue)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .background(Color(red: 0.11, green: 0.11, blue: 0.12))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    // MARK: - Safety Guarantees Card

    private var safetyGuaranteesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("DATA SAFETY & ZERO-LOSS GUARANTEES")
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundColor(.white.opacity(0.6))
                .padding(.horizontal, 4)

            VStack(spacing: 0) {
                safetyPointRow(
                    icon: "livephoto",
                    iconColor: .teal,
                    number: "01",
                    title: "Live Photo & Companion Integrity",
                    desc: "HEIC images and companion .MOV files are extracted and uploaded together with identical bundle IDs."
                )

                Rectangle()
                    .fill(Color.white.opacity(0.1))
                    .frame(height: 0.5)

                safetyPointRow(
                    icon: "video.fill",
                    iconColor: .indigo,
                    number: "02",
                    title: "OOM-Safe Streaming Video",
                    desc: "Large 4K videos stream from disk to prevent RAM exhaustion and app termination."
                )

                Rectangle()
                    .fill(Color.white.opacity(0.1))
                    .frame(height: 0.5)

                safetyPointRow(
                    icon: "lock.shield.fill",
                    iconColor: .green,
                    number: "03",
                    title: "100% SHA-256 Ledger Verification",
                    desc: "Mac server computes SHA-256 hashes and records them in JSON ledger before acknowledging receipt."
                )

                Rectangle()
                    .fill(Color.white.opacity(0.1))
                    .frame(height: 0.5)

                safetyPointRow(
                    icon: "trash.slash.fill",
                    iconColor: .blue,
                    number: "04",
                    title: "Atomic Post-Verification Deletion",
                    desc: "PhotoKit deletion is only called AFTER 100% verified uploads. HD+Phone and Unsorted files are NEVER deleted."
                )
            }
            .background(Color(red: 0.11, green: 0.11, blue: 0.12))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private func safetyPointRow(icon: String, iconColor: Color, number: String, title: String, desc: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            SettingsIconBadge(icon: icon, color: iconColor)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)

                    Spacer()

                    Text(number)
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundColor(.white.opacity(0.4))
                }

                Text(desc)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.white.opacity(0.5))
                    .lineSpacing(2)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - System Info Card

    private var systemInfoCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("ABOUT")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.white.opacity(0.6))
                .padding(.horizontal, 4)

            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    SettingsIconBadge(icon: "info.circle.fill", color: .gray)

                    Text("Engine")
                        .font(.system(size: 14))
                        .foregroundColor(.white)

                    Spacer()

                    Text("PhotoTriage Client 1.0 (Swift 6)")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(.white.opacity(0.6))
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)

                Rectangle()
                    .fill(Color.white.opacity(0.1))
                    .frame(height: 0.5)

                HStack(spacing: 12) {
                    SettingsIconBadge(icon: "shield.lefthalf.filled", color: .blue)

                    Text("Architecture")
                        .font(.system(size: 14))
                        .foregroundColor(.white)

                    Spacer()

                    Text("Zero-Data-Loss Ledger")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(.blue)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .background(Color(red: 0.11, green: 0.11, blue: 0.12))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}
