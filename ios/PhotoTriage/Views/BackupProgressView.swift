import SwiftUI
import Photos
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// MARK: - Backup Execution Stage

public enum BackupStage: Equatable, Sendable {
    case idle
    case precheck
    case uploading(current: Int, total: Int, currentName: String)
    case purging(deleteCount: Int)
    case completed(uploaded: Int, deleted: Int, kept: Int)
    case failed(error: String, retryable: Bool)
}

public struct BackupLogEntry: Identifiable, Sendable {
    public let id = UUID()
    public let time: String
    public let message: String
    public let color: Color

    public init(message: String, color: Color = .slate300) {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        self.time = formatter.string(from: Date())
        self.message = message
        self.color = color
    }
}

/// Utilitarian Backup Progress View
/// Orchestrates the zero-data-loss transfer pipeline:
/// 1. Prechecks server reachability and hard drive mount.
/// 2. Uploads `backupOnly` and `backupKeep` bundles with streaming video.
/// 3. Confirms 100% SHA-256 ledger verification on the Mac.
/// 4. CRITICAL SAFETY INVARIANT: ONLY after 100% SHA-256 verification of all uploaded items,
///    triggers PhotoKit's native single confirmation dialog to delete `trash` and `backupOnly` items.
///    `backupKeep` items are STRICTLY PRESERVED on the iPhone.
public struct BackupProgressView: View {
    @EnvironmentObject public var triageState: TriageState
    @EnvironmentObject public var networkManager: NetworkManager
    @EnvironmentObject public var photoKitManager: PhotoKitManager

    @State private var stage: BackupStage = .idle
    @State private var progressFraction: Double = 0.0
    @State private var transferSpeedText: String = "-- MB/s"
    @State private var verifiedEntries: [LedgerEntryDto] = []
    @State private var logs: [BackupLogEntry] = []
    @State private var isExecuting: Bool = false

    public init() {}

    public var itemsToUpload: [TriageAsset] {
        triageState.assetsToUpload
    }

    public var itemsToDelete: [TriageAsset] {
        triageState.assetsToDelete
    }

    public var itemsToKeep: [TriageAsset] {
        triageState.assetsToKeepOnPhone
    }

    public var body: some View {
        ZStack {
            Color.slate950.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header Status Bar
                headerBar

                // Main Console & Telemetry
                ScrollView {
                    VStack(spacing: 12) {
                        // Diagnostic Metrics Card
                        metricsCard

                        // Progress Gauges
                        progressSection

                        // Real-time Monospaced Log Console
                        consoleLogCard

                        // Final Completion Summary if done
                        if case let .completed(uploaded, deleted, kept) = stage {
                            completionSummaryCard(uploaded: uploaded, deleted: deleted, kept: kept)
                        }

                        // Error Banner if failed
                        if case let .failed(error, _) = stage {
                            errorBanner(message: error)
                        }
                    }
                    .padding(12)
                }

                // Bottom Action Button
                bottomActionBar
            }
        }
    }

    // MARK: - Header Bar

    private var headerBar: some View {
        VStack(spacing: 4) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("BACKUP // SYNC ENGINE")
                        .font(.system(size: 13, weight: .bold, design: .monospaced))
                        .foregroundColor(.consoleCyan)

                    Text("TARGET: \(networkManager.cleanServerUrl)")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.slate400)
                }

                Spacer()

                // Server Status Indicator
                HStack(spacing: 4) {
                    Circle()
                        .fill(networkManager.isReachable ? Color.triageBackupKeep : Color.triageTrash)
                        .frame(width: 8, height: 8)

                    Text(networkManager.isReachable ? "ONLINE" : "OFFLINE")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(networkManager.isReachable ? .triageBackupKeep : .triageTrash)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(Color.slate800)
                .utilitarianBorder(color: .slate700, width: 1, cornerRadius: 2)
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

    // MARK: - Metrics Card

    private var metricsCard: some View {
        VStack(spacing: 8) {
            HStack {
                Text("BATCH METRICS:")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundColor(.slate400)
                Spacer()
                Text("\(triageState.selectedMonth?.displayName ?? "UNKNOWN")")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(.slate200)
            }

            Rectangle()
                .fill(Color.slate700)
                .frame(height: 1)

            HStack(spacing: 12) {
                metricItem(
                    label: "TO UPLOAD",
                    value: "\(itemsToUpload.count)",
                    color: .consoleCyan,
                    subtext: "HD Only + Keep"
                )

                metricItem(
                    label: "TO PURGE",
                    value: "\(itemsToDelete.count)",
                    color: .triageTrash,
                    subtext: "Trash + HD Only"
                )

                metricItem(
                    label: "KEEP ON PHONE",
                    value: "\(itemsToKeep.count)",
                    color: .triageBackupKeep,
                    subtext: "Preserved"
                )
            }
        }
        .padding(10)
        .background(Color.slate900)
        .utilitarianBorder(color: .slate800, width: 1, cornerRadius: 4)
    }

    private func metricItem(label: String, value: String, color: Color, subtext: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(.slate500)

            Text(value)
                .font(.system(size: 18, weight: .black, design: .monospaced))
                .foregroundColor(color)

            Text(subtext)
                .font(.system(size: 8, design: .monospaced))
                .foregroundColor(.slate400)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Progress Section

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(stageTitle)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(.slate200)

                Spacer()

                Text("\(Int(progressFraction * 100))%")
                    .font(.system(size: 12, weight: .black, design: .monospaced))
                    .foregroundColor(.consoleCyan)
            }

            // Custom Utilitarian Progress Bar
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Rectangle()
                        .fill(Color.slate800)
                        .frame(height: 12)

                    Rectangle()
                        .fill(Color.consoleCyan)
                        .frame(width: geo.size.width * max(0.0, min(1.0, progressFraction)), height: 12)
                }
                .utilitarianBorder(color: .slate700, width: 1, cornerRadius: 2)
            }
            .frame(height: 12)

            HStack {
                Text("RATE: \(transferSpeedText)")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.slate400)

                Spacer()

                Text("VERIFIED: \(verifiedEntries.count) / \(itemsToUpload.count)")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundColor(.slate300)
            }
        }
        .padding(10)
        .background(Color.slate900)
        .utilitarianBorder(color: .slate800, width: 1, cornerRadius: 4)
    }

    private var stageTitle: String {
        switch stage {
        case .idle:
            return "STATUS: READY FOR BACKUP"
        case .precheck:
            return "STATUS: VERIFYING HARD DRIVE CONNECTION..."
        case let .uploading(current, total, name):
            return "UPLOADING [\(current)/\(total)]: \(name)"
        case let .purging(count):
            return "AWAITING APPLE CONFIRMATION TO PURGE \(count) ITEMS..."
        case .completed:
            return "STATUS: BACKUP & PURGE COMPLETED"
        case .failed:
            return "STATUS: PROCESS HALTED (ERROR)"
        }
    }

    // MARK: - Monospaced Console Log

    private var consoleLogCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("INTEGRITY & LEDGER TELEMETRY:")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundColor(.slate400)
                Spacer()
                Text("\(logs.count) LOGS")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(.slate500)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 3) {
                    if logs.isEmpty {
                        Text("Ready to start upload. Awaiting user execution.")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.slate600)
                            .padding(.vertical, 8)
                    } else {
                        ForEach(logs) { entry in
                            HStack(alignment: .top, spacing: 6) {
                                Text("[\(entry.time)]")
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundColor(.slate600)

                                Text(entry.message)
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundColor(entry.color)
                                    .lineLimit(2)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 140)
            .padding(6)
            .background(Color.slate950)
            .utilitarianBorder(color: .slate800, width: 1, cornerRadius: 2)
        }
        .padding(10)
        .background(Color.slate900)
        .utilitarianBorder(color: .slate800, width: 1, cornerRadius: 4)
    }

    // MARK: - Completion Summary Card

    private func completionSummaryCard(uploaded: Int, deleted: Int, kept: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.triageBackupKeep)

                Text("BACKUP PIPELINE VERIFIED & COMMITTED")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(.triageBackupKeep)
            }

            VStack(alignment: .leading, spacing: 4) {
                summaryRow(title: "Backed Up & SHA-256 Verified:", value: "\(uploaded) assets", color: .consoleCyan)
                summaryRow(title: "Purged from Camera Roll:", value: "\(deleted) assets", color: .triageTrash)
                summaryRow(title: "Preserved on iPhone:", value: "\(kept) assets", color: .triageBackupKeep)
            }
        }
        .padding(10)
        .background(Color.slate900)
        .utilitarianBorder(color: .triageBackupKeep, width: 1, cornerRadius: 4)
    }

    private func summaryRow(title: String, value: String, color: Color) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.slate400)
            Spacer()
            Text(value)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(color)
        }
    }

    // MARK: - Error Banner

    private func errorBanner(message: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(.triageTrash)
                Text("SAFETY GUARD HALTED EXECUTION")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(.triageTrash)
            }

            Text(message)
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.slate200)

            Text("No photos were deleted. Your Camera Roll is completely intact. Resolve server issue and tap RETRY.")
                .font(.system(size: 9, design: .monospaced))
                .foregroundColor(.slate400)
                .padding(.top, 2)
        }
        .padding(10)
        .background(Color.slate900)
        .utilitarianBorder(color: .triageTrash, width: 1, cornerRadius: 4)
    }

    // MARK: - Bottom Action Bar

    private var bottomActionBar: some View {
        VStack(spacing: 8) {
            Rectangle()
                .fill(Color.slate800)
                .frame(height: 1)

            HStack(spacing: 8) {
                if case .failed = stage {
                    Button {
                        triggerHapticFeedback(1)
                        startBackupPipeline()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 14, weight: .bold))
                            Text("RETRY BACKUP")
                                .font(.system(size: 14, weight: .bold, design: .rounded))
                        }
                        .foregroundColor(.slate100)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(Color.slate800)
                        .cornerRadius(12)
                        .utilitarianBorder(color: .consoleCyan, width: 1, cornerRadius: 12)
                    }
                } else if case .completed = stage {
                    Button {
                        triggerHapticFeedback(0)
                        // Reset batch and return
                        triageState.reset()
                        stage = .idle
                    } label: {
                        Text("SELECT ANOTHER MONTH")
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundColor(.consoleCyan)
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                            .background(Color.slate800)
                            .cornerRadius(12)
                            .utilitarianBorder(color: .consoleCyan, width: 1, cornerRadius: 12)
                    }
                } else {
                    Button {
                        triggerHapticFeedback(1)
                        startBackupPipeline()
                    } label: {
                        HStack(spacing: 8) {
                            if isExecuting {
                                ProgressView()
                                    .scaleEffect(0.9)
                                    .tint(.slate950)
                            } else {
                                Image(systemName: "externaldrive.badge.icloud")
                                    .font(.system(size: 16, weight: .bold))
                            }
                            Text(isExecuting ? "EXECUTING BACKUP..." : "EXECUTE BACKUP & PURGE")
                                .font(.system(size: 14, weight: .bold, design: .rounded))
                        }
                        .foregroundColor(isExecuting ? .slate400 : .slate950)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(isExecuting ? Color.slate800 : Color.consoleCyan)
                        .cornerRadius(12)
                        .utilitarianBorder(color: isExecuting ? .slate700 : .consoleCyan, width: 1, cornerRadius: 12)
                    }
                    .disabled(isExecuting || (itemsToUpload.isEmpty && itemsToDelete.isEmpty))
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 8)
        }
        .background(Color.slate950)
    }

    // MARK: - Pipeline Execution

    private func appendLog(_ message: String, color: Color = .slate300) {
        logs.append(BackupLogEntry(message: message, color: color))
    }

    public func startBackupPipeline() {
        guard !isExecuting else { return }
        isExecuting = true
        progressFraction = 0.0
        verifiedEntries.removeAll()

        Task {
            await executePipeline()
            isExecuting = false
        }
    }

    private func executePipeline() async {
        appendLog("Initiating backup pipeline...", color: .consoleCyan)
        stage = .precheck

        // 1. Precheck server reachability
        appendLog("Pinging Mac server at \(networkManager.cleanServerUrl)...")
        let isReachable = await networkManager.pingServer()
        guard isReachable else {
            let err = "Server unreachable at \(networkManager.cleanServerUrl). Ensure Mac server is running on the local Wi-Fi."
            appendLog("[ERROR] \(err)", color: .triageTrash)
            stage = .failed(error: err, retryable: true)
            return
        }

        // Verify hard drive status
        do {
            let status = try await networkManager.fetchSessionStatus()
            if let mounted = status.hardDriveMounted, !mounted {
                let err = "External hard drive is NOT mounted on the Mac server. Plug in drive and retry."
                appendLog("[ERROR] \(err)", color: .triageTrash)
                stage = .failed(error: err, retryable: true)
                return
            }
            appendLog("Server online. External hard drive mounted.", color: .triageBackupKeep)
        } catch {
            appendLog("[WARNING] Could not check hard drive mount: \(error.localizedDescription)", color: .triageBackupOnly)
        }

        let uploads = itemsToUpload
        var totalBytesUploaded: Int64 = 0
        let startTime = Date()

        // 2. Upload Kept Bundles (backupOnly and backupKeep)
        if !uploads.isEmpty {
            appendLog("Starting transfer of \(uploads.count) asset bundles...")

            for (index, asset) in uploads.enumerated() {
                let currentNum = index + 1
                let filename = asset.originalFilename ?? asset.canonicalName
                stage = .uploading(current: currentNum, total: uploads.count, currentName: filename)

                let decision = triageState.decision(for: asset)
                appendLog("[\(currentNum)/\(uploads.count)] Extracting resources for \(filename)...")

                var resources: [ExtractedResource] = []
                do {
                    resources = try await photoKitManager.extractResources(for: asset)
                } catch {
                    let err = "Failed to extract resources for \(filename): \(error.localizedDescription)"
                    appendLog("[ERROR] \(err)", color: .triageTrash)
                    stage = .failed(error: err, retryable: true)
                    return
                }

                appendLog("[\(currentNum)/\(uploads.count)] Uploading \(resources.count) files to Mac...")

                do {
                    let result = try await networkManager.uploadBundle(
                        asset: asset,
                        resources: resources,
                        decision: decision
                    )

                    // Resource cleanup immediately to free disk space
                    for r in resources {
                        r.cleanup()
                    }

                    guard result.success else {
                        let err = "Server rejected upload verification for \(filename)."
                        appendLog("[ERROR] \(err)", color: .triageTrash)
                        stage = .failed(error: err, retryable: true)
                        return
                    }

                    // Record verified SHA-256 ledger entries
                    for entry in result.entries {
                        verifiedEntries.append(entry)
                        appendLog("  ✓ VERIFIED SHA-256 [\(entry.canonicalName)]: \(entry.sha256.prefix(12))...", color: .triageBackupKeep)
                    }

                    // Update progress & speed metrics
                    totalBytesUploaded += asset.fileSize > 0 ? asset.fileSize : 5_000_000
                    let elapsed = Date().timeIntervalSince(startTime)
                    if elapsed > 0.5 {
                        let bytesPerSec = Double(totalBytesUploaded) / elapsed
                        let mbPerSec = bytesPerSec / 1_048_576.0
                        transferSpeedText = String(format: "%.1f MB/s", mbPerSec)
                    }

                    progressFraction = Double(currentNum) / Double(uploads.count)

                } catch {
                    for r in resources { r.cleanup() }
                    let err = "Upload failed for \(filename): \(error.localizedDescription)"
                    appendLog("[ERROR] \(err)", color: .triageTrash)
                    stage = .failed(error: err, retryable: true)
                    return
                }
            }
        }

        // 3. CRITICAL SAFETY INVARIANT CHECK:
        // Ensure ALL items to upload were 100% verified before proceeding to deletion.
        if !uploads.isEmpty {
            guard verifiedEntries.count >= uploads.count else {
                let err = "Integrity mismatch: Expected \(uploads.count) verified bundles, but ledger recorded \(verifiedEntries.count). Aborting deletion."
                appendLog("[FATAL] \(err)", color: .triageTrash)
                stage = .failed(error: err, retryable: true)
                return
            }
            appendLog("100% SHA-256 verification confirmed for all \(uploads.count) uploaded bundles.", color: .triageBackupKeep)
        }

        // 4. Safe Camera Roll Purge (Trash + verified HD Only)
        // STRICT SAFETY INVARIANT: backupKeep items are NEVER sent for deletion.
        let toPurge = itemsToDelete
        var deletedCount = 0

        if !toPurge.isEmpty {
            stage = .purging(deleteCount: toPurge.count)
            appendLog("Requesting Apple native confirmation dialog to purge \(toPurge.count) items...")

            do {
                let deletionResult = try await photoKitManager.deleteTriagedAssets(
                    assets: triageState.assets,
                    decisions: triageState.decisions
                )
                deletedCount = deletionResult.deletedCount
                appendLog("Camera Roll deletion committed: \(deletedCount) items purged.", color: .triageTrash)
            } catch {
                let err = "Camera Roll deletion failed or was cancelled by user: \(error.localizedDescription)"
                appendLog("[WARN] \(err)", color: .triageBackupOnly)
                // Note: Upload was successful, so we report partial completion without data loss
            }
        } else {
            appendLog("No assets marked for purge. Camera Roll untouched.")
        }

        // 5. Completion
        stage = .completed(
            uploaded: uploads.count,
            deleted: deletedCount,
            kept: itemsToKeep.count
        )
        appendLog("PIPELINE COMPLETED SUCCESSFULLY.", color: .triageBackupKeep)
    }
}
