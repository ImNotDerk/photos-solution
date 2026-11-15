import SwiftUI
import Photos
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Utilitarian Single Triage View
/// Provides high-density, 1-by-1 photo inspection with monospaced metadata,
/// tactile physical buttons, and rapid swipe gesture classification.
public struct SingleTriageView: View {
    @EnvironmentObject public var triageState: TriageState
    @EnvironmentObject public var photoKitManager: PhotoKitManager

    // Image loading state
    @State private var currentImage: UIImage? = nil
    @State private var isLoadingImage = false

    // Zoom and Pan
    @State private var zoomScale: CGFloat = 1.0
    @State private var dragOffset: CGSize = .zero
    @State private var gestureDecisionHint: TriageDecision? = nil

    public init() {}

    public var currentAsset: TriageAsset? {
        triageState.currentAsset
    }

    public var currentDecision: TriageDecision {
        guard let asset = currentAsset else { return .unsorted }
        return triageState.decision(for: asset)
    }

    public var body: some View {
        ZStack {
            Color.slate950.ignoresSafeArea()

            if let asset = currentAsset {
                VStack(spacing: 0) {
                    // Top Metadata & Progress Header
                    metadataHeader(for: asset)

                    // Photo Viewing Canvas with Gesture Support
                    photoCanvas(for: asset)

                    // Decision Stamp HUD
                    decisionStatusBar(for: asset)

                    // Bottom Tactile Action Bar
                    tactileActionBar
                }
            } else {
                emptyStateView
            }
        }
        .task(id: currentAsset?.id) {
            await reloadImage()
        }
    }

    // MARK: - Metadata Header

    private func metadataHeader(for asset: TriageAsset) -> some View {
        VStack(spacing: 6) {
            // Index & Status Row
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "folder.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.consoleCyan)
                    Text("\(triageState.selectedMonth?.displayName ?? "UNKNOWN")")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundColor(.slate100)
                }

                Spacer()

                // Progress Counter
                HStack(spacing: 4) {
                    Text("\(triageState.currentIndex + 1) of \(triageState.totalCount)")
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundColor(.slate200)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.slate800)
                .cornerRadius(6)
            }

            // High-density Technical Spec Line
            HStack(spacing: 8) {
                // Filename
                Text(asset.originalFilename ?? asset.canonicalName)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.slate200)
                    .lineLimit(1)

                Spacer()

                // Dimensions
                Text(asset.formattedDimensions)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.slate400)

                // Size
                Text(asset.formattedSize)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(.slate300)

                // Media type badges
                if asset.isLivePhoto {
                    badgeView(text: "LIVE", color: .consoleCyan)
                }
                if asset.isVideo {
                    badgeView(text: asset.formattedDuration ?? "VIDEO", color: .triageBackupOnly)
                }
            }

            // Destination and timestamp
            HStack {
                Text("DATE: \(asset.formattedDate)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.slate400)

                Spacer()

                Text("DEST: /\(asset.targetYear)/\(asset.targetMonth)/")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundColor(.consoleCyan)
            }

            Rectangle()
                .fill(Color.slate800)
                .frame(height: 1)
                .padding(.top, 2)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .background(Color.slate900)
    }

    private func badgeView(text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundColor(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.18))
            .cornerRadius(4)
            .utilitarianBorder(color: color, width: 1, cornerRadius: 4)
    }

    // MARK: - Photo Canvas

    private func photoCanvas(for asset: TriageAsset) -> some View {
        GeometryReader { geometry in
            ZStack {
                Color.slate950

                if let image = currentImage {
                    Image(platformImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .scaleEffect(zoomScale)
                        .offset(dragOffset)
                        .frame(maxWidth: geometry.size.width, maxHeight: geometry.size.height)
                        .gesture(dragGesture(size: geometry.size))
                        .simultaneousGesture(magnificationGesture)
                        .onTapGesture(count: 2) {
                            withAnimation(.easeInOut(duration: 0.15)) {
                                zoomScale = (zoomScale > 1.2) ? 1.0 : 2.5
                            }
                        }
                } else if isLoadingImage {
                    VStack(spacing: 8) {
                        ProgressView()
                            .tint(.consoleCyan)
                        Text("RENDERING ASSET...")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundColor(.slate500)
                    }
                } else {
                    VStack(spacing: 6) {
                        Image(systemName: "photo")
                            .font(.system(size: 28))
                            .foregroundColor(.slate700)
                        Text("PREVIEW NOT AVAILABLE")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.slate600)
                    }
                }

                // Visual Decision Overlay (Swipe HUD Indicator)
                if let hint = gestureDecisionHint {
                    decisionIndicatorOverlay(decision: hint)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
        }
    }

    // MARK: - Gestures

    private var magnificationGesture: some Gesture {
        MagnificationGesture()
            .onChanged { scale in
                zoomScale = max(1.0, min(5.0, scale))
            }
            .onEnded { _ in
                if zoomScale < 1.05 {
                    zoomScale = 1.0
                }
            }
    }

    private func dragGesture(size: CGSize) -> some Gesture {
        DragGesture()
            .onChanged { val in
                // Only allow swipe triage gestures when not zoomed in
                guard zoomScale <= 1.05 else { return }
                dragOffset = val.translation

                let x = val.translation.width
                let y = val.translation.height

                if y < -80 && abs(y) > abs(x) {
                    gestureDecisionHint = .backupOnly
                } else if x < -80 {
                    gestureDecisionHint = .trash
                } else if x > 80 {
                    gestureDecisionHint = .backupKeep
                } else {
                    gestureDecisionHint = nil
                }
            }
            .onEnded { val in
                guard zoomScale <= 1.05 else { return }
                let x = val.translation.width
                let y = val.translation.height

                if y < -80 && abs(y) > abs(x) {
                    applyDecision(.backupOnly)
                } else if x < -80 {
                    applyDecision(.trash)
                } else if x > 80 {
                    applyDecision(.backupKeep)
                }

                dragOffset = .zero
                gestureDecisionHint = nil
            }
    }

    private func applyDecision(_ decision: TriageDecision) {
        triageState.triageCurrent(as: decision, autoAdvance: true)
    }

    // MARK: - Decision Overlay & Status

    private func decisionIndicatorOverlay(decision: TriageDecision) -> some View {
        VStack(spacing: 6) {
            Image(systemName: decision.iconName)
                .font(.system(size: 32, weight: .bold))
                .foregroundColor(decision.color)

            Text(decision.title.uppercased())
                .font(.system(size: 16, weight: .black, design: .monospaced))
                .foregroundColor(decision.color)

            Text(decision.subtitle.uppercased())
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(.slate200)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .background(Color.slate900.opacity(0.92))
        .utilitarianBorder(color: decision.color, width: 2, cornerRadius: 4)
    }

    private func decisionStatusBar(for asset: TriageAsset) -> some View {
        HStack(spacing: 12) {
            // Decision Badge
            HStack(spacing: 8) {
                Text("STATUS:")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(.slate400)

                Text(currentDecision.title.uppercased())
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundColor(currentDecision.color)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(currentDecision.color.opacity(0.18))
                    .cornerRadius(6)
                    .utilitarianBorder(color: currentDecision.color, width: 1, cornerRadius: 6)
            }

            Spacer()

            // Undo Button (Comfortable 38pt height)
            Button {
                triggerHapticFeedback(0)
                triageState.undo()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.uturn.backward")
                        .font(.system(size: 12, weight: .bold))
                    Text("UNDO")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                }
                .foregroundColor(triageState.canUndo ? .slate100 : .slate600)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(triageState.canUndo ? Color.slate800 : Color.slate900)
                .cornerRadius(8)
                .utilitarianBorder(color: triageState.canUndo ? .slate600 : .slate800, width: 1, cornerRadius: 8)
            }
            .disabled(!triageState.canUndo)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color.slate900)
    }

    // MARK: - Tactile Action Bar

    private var tactileActionBar: some View {
        VStack(spacing: 10) {
            Rectangle()
                .fill(Color.slate800)
                .frame(height: 1)

            // Primary 3-Way Triage Controls (Comfortable 56pt height!)
            HStack(spacing: 10) {
                // Trash Button (Delete from Phone)
                Button {
                    triggerHapticFeedback(1)
                    applyDecision(.trash)
                } label: {
                    VStack(spacing: 3) {
                        HStack(spacing: 4) {
                            Image(systemName: "trash.fill")
                                .font(.system(size: 15, weight: .bold))
                            Text("🗑️ Trash")
                                .font(.system(size: 14, weight: .bold, design: .rounded))
                        }
                        Text("Delete from phone")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(.triageTrash.opacity(0.85))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(currentDecision == .trash ? Color.triageTrash.opacity(0.35) : Color.triageTrash.opacity(0.12))
                    .cornerRadius(12)
                    .utilitarianBorder(color: .triageTrash, width: currentDecision == .trash ? 2 : 1, cornerRadius: 12)
                }
                .foregroundColor(.triageTrash)

                // HD Only Button (Offload to Hard Drive)
                Button {
                    triggerHapticFeedback(1)
                    applyDecision(.backupOnly)
                } label: {
                    VStack(spacing: 3) {
                        HStack(spacing: 4) {
                            Image(systemName: "externaldrive.fill")
                                .font(.system(size: 15, weight: .bold))
                            Text("💾 HD Only")
                                .font(.system(size: 14, weight: .bold, design: .rounded))
                        }
                        Text("Offload to HD")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(.triageBackupOnly.opacity(0.85))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(currentDecision == .backupOnly ? Color.triageBackupOnly.opacity(0.35) : Color.triageBackupOnly.opacity(0.12))
                    .cornerRadius(12)
                    .utilitarianBorder(color: .triageBackupOnly, width: currentDecision == .backupOnly ? 2 : 1, cornerRadius: 12)
                }
                .foregroundColor(.triageBackupOnly)

                // HD + Phone Button (Back up and keep)
                Button {
                    triggerHapticFeedback(1)
                    applyDecision(.backupKeep)
                } label: {
                    VStack(spacing: 3) {
                        HStack(spacing: 4) {
                            Image(systemName: "iphone.badge.checkmark")
                                .font(.system(size: 15, weight: .bold))
                            Text("💾+📱 HD+Phone")
                                .font(.system(size: 14, weight: .bold, design: .rounded))
                        }
                        Text("Backup & keep")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(.triageBackupKeep.opacity(0.85))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(currentDecision == .backupKeep ? Color.triageBackupKeep.opacity(0.35) : Color.triageBackupKeep.opacity(0.12))
                    .cornerRadius(12)
                    .utilitarianBorder(color: .triageBackupKeep, width: currentDecision == .backupKeep ? 2 : 1, cornerRadius: 12)
                }
                .foregroundColor(.triageBackupKeep)
            }
            .padding(.horizontal, 14)

            // Bottom Navigation Stepper Row (44pt touch targets)
            HStack(spacing: 12) {
                Button {
                    triggerHapticFeedback(0)
                    triageState.goToPrevious()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left")
                        Text("PREV")
                    }
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundColor(triageState.canGoPrevious ? .slate100 : .slate600)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(Color.slate800)
                    .cornerRadius(10)
                    .utilitarianBorder(color: triageState.canGoPrevious ? .slate700 : .slate800, width: 1, cornerRadius: 10)
                }
                .disabled(!triageState.canGoPrevious)

                // Gesture hint
                Text("SWIPE: ◀ TRASH | UP: HD | KEEP: ▶")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundColor(.slate400)
                    .lineLimit(1)

                Button {
                    triggerHapticFeedback(0)
                    triageState.goToNext()
                } label: {
                    HStack(spacing: 6) {
                        Text("NEXT")
                        Image(systemName: "chevron.right")
                    }
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundColor(triageState.canGoNext ? .slate100 : .slate600)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(Color.slate800)
                    .cornerRadius(10)
                    .utilitarianBorder(color: triageState.canGoNext ? .slate700 : .slate800, width: 1, cornerRadius: 10)
                }
                .disabled(!triageState.canGoNext)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 8)
        }
        .background(Color.slate950)
    }

    // MARK: - Helpers

    private func reloadImage() async {
        guard let asset = currentAsset else {
            currentImage = nil
            return
        }

        isLoadingImage = true
        zoomScale = 1.0
        dragOffset = .zero

        let img = await photoKitManager.loadFullImage(for: asset)
        currentImage = img
        isLoadingImage = false
    }

    private var emptyStateView: some View {
        VStack(spacing: 12) {
            Image(systemName: "folder.badge.questionmark")
                .font(.system(size: 32))
                .foregroundColor(.slate600)

            Text("NO BATCH LOADED")
                .font(.system(size: 14, weight: .bold, design: .monospaced))
                .foregroundColor(.slate300)

            Text("Select a calendar month from Directory to start review.")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.slate500)
        }
    }
}
