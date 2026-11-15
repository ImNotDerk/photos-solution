import SwiftUI

/// Utilitarian Settings View
/// Allows configuring the Mac backup server URL, testing local network reachability,
/// inspecting external hard drive mount status, and reviewing safety invariants.
public struct SettingsView: View {
    @EnvironmentObject public var networkManager: NetworkManager

    @State private var inputUrl: String = ""
    @State private var isPinging: Bool = false
    @State private var pingResult: String? = nil
    @State private var sessionStatus: ServerSessionStatus? = nil
    @State private var statusError: String? = nil

    public init() {}

    public var body: some View {
        ZStack {
            Color.slate950.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header Bar
                headerBar

                // Content
                ScrollView {
                    VStack(spacing: 12) {
                        // Server Endpoint Configuration Card
                        serverConfigCard

                        // Live Diagnostics Card
                        diagnosticsCard

                        // System Architecture & Safety Invariants Card
                        safetyGuaranteesCard

                        // Build & Engine Info
                        systemInfoCard
                    }
                    .padding(12)
                }
            }
        }
        .onAppear {
            inputUrl = networkManager.serverUrl
        }
    }

    // MARK: - Header Bar

    private var headerBar: some View {
        VStack(spacing: 4) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("SYSTEM // SETTINGS & TELEMETRY")
                        .font(.system(size: 13, weight: .bold, design: .monospaced))
                        .foregroundColor(.consoleCyan)

                    Text("CONFIGURATION & SERVER HEALTH")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.slate400)
                }

                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 6)

            Rectangle()
                .fill(Color.slate800)
                .frame(height: 1)
        }
        .background(Color.slate900)
    }

    // MARK: - Server Configuration Card

    private var serverConfigCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("MAC BACKUP SERVER HOST:")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(.slate400)

                Spacer()

                Button {
                    triggerHapticFeedback(0)
                    inputUrl = NetworkManager.defaultServerUrl
                    saveUrl()
                } label: {
                    Text("DEFAULT")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(.slate300)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.slate800)
                        .cornerRadius(6)
                        .utilitarianBorder(color: .slate700, width: 1, cornerRadius: 6)
                }
            }

            // Input Field (Comfortable 44pt touch area)
            HStack(spacing: 8) {
                Image(systemName: "network")
                    .font(.system(size: 14))
                    .foregroundColor(.consoleCyan)

                TextField("http://10.142.1.127:3000", text: $inputUrl)
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundColor(.slate100)
                    #if canImport(UIKit)
                    .autocapitalization(.none)
                    .keyboardType(.URL)
                    .disableAutocorrection(true)
                    #endif
                    .onSubmit {
                        saveUrl()
                    }
            }
            .padding(12)
            .background(Color.slate950)
            .cornerRadius(10)
            .utilitarianBorder(color: .slate700, width: 1, cornerRadius: 10)

            // Save and Test Buttons
            HStack(spacing: 10) {
                Button {
                    triggerHapticFeedback(0)
                    saveUrl()
                } label: {
                    Text("SAVE URL")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundColor(.slate100)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(Color.slate800)
                        .cornerRadius(10)
                        .utilitarianBorder(color: .slate600, width: 1, cornerRadius: 10)
                }

                Button {
                    triggerHapticFeedback(1)
                    saveUrl()
                    runDiagnostics()
                } label: {
                    HStack(spacing: 6) {
                        if isPinging {
                            ProgressView()
                                .scaleEffect(0.7)
                                .tint(.slate950)
                        } else {
                            Image(systemName: "bolt.fill")
                        }
                        Text(isPinging ? "TESTING..." : "TEST CONNECTION")
                    }
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundColor(.slate950)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(Color.consoleCyan)
                    .cornerRadius(10)
                    .utilitarianBorder(color: .consoleCyan, width: 1, cornerRadius: 10)
                }
                .disabled(isPinging)
            }
        }
        .padding(10)
        .background(Color.slate900)
        .utilitarianBorder(color: .slate800, width: 1, cornerRadius: 4)
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
            return ("UNKNOWN (Run connection test)", Color.slate500)
        }
    }

    private var diagnosticsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("LIVE SERVER DIAGNOSTICS:")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.slate400)

            Rectangle()
                .fill(Color.slate800)
                .frame(height: 1)

            // Reachability Status Row
            statusRow(
                label: "SERVER REACHABILITY:",
                statusText: networkManager.isReachable ? "ONLINE (HTTP 200)" : "OFFLINE / UNREACHABLE",
                color: networkManager.isReachable ? .triageBackupKeep : .triageTrash
            )

            // External Hard Drive Row
            statusRow(
                label: "EXTERNAL HARD DRIVE:",
                statusText: hardDriveStatusInfo.text,
                color: hardDriveStatusInfo.color
            )

            if let result = pingResult {
                HStack {
                    Text("DIAGNOSTIC LOG:")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundColor(.slate500)
                    Spacer()
                    Text(result)
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundColor(.slate300)
                }
            }

            if let err = statusError {
                Text("[ERROR] \(err)")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(.triageTrash)
            }
        }
        .padding(10)
        .background(Color.slate900)
        .utilitarianBorder(color: .slate800, width: 1, cornerRadius: 4)
    }

    private func statusRow(label: String, statusText: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(.slate500)

            Text(statusText)
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundColor(color)
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

    // MARK: - Safety Guarantees Card

    private var safetyGuaranteesCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("DATA SAFETY & ZERO-LOSS GUARANTEES:")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.slate400)

            Rectangle()
                .fill(Color.slate800)
                .frame(height: 1)

            safetyPoint(
                number: "01",
                title: "Live Photo & Companion Integrity",
                desc: "HEIC images and companion .MOV files are extracted and uploaded together with identical bundle IDs."
            )

            safetyPoint(
                number: "02",
                title: "OOM-Safe Streaming Video",
                desc: "Large 4K videos stream from disk to prevent RAM exhaustion and app termination."
            )

            safetyPoint(
                number: "03",
                title: "100% SHA-256 Ledger Verification",
                desc: "Mac server computes SHA-256 hashes and records them in JSON ledger before acknowledging receipt."
            )

            safetyPoint(
                number: "04",
                title: "Atomic Post-Verification Deletion",
                desc: "PhotoKit deletion is only called AFTER 100% verified uploads. HD+Phone and Unsorted files are NEVER deleted."
            )
        }
        .padding(10)
        .background(Color.slate900)
        .utilitarianBorder(color: .slate800, width: 1, cornerRadius: 4)
    }

    private func safetyPoint(number: String, title: String, desc: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(number)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.consoleCyan)

            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundColor(.slate200)

                Text(desc)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(.slate400)
            }
        }
    }

    // MARK: - System Info Card

    private var systemInfoCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("ENGINE:")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(.slate500)
                Spacer()
                Text("PhotoTriage Client 1.0 (Swift 6)")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(.slate300)
            }

            HStack {
                Text("AESTHETIC:")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(.slate500)
                Spacer()
                Text("Utilitarian Dark Slate Terminal")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(.consoleCyan)
            }
        }
        .padding(10)
        .background(Color.slate900)
        .utilitarianBorder(color: .slate800, width: 1, cornerRadius: 4)
    }
}
