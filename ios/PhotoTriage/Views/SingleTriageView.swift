import SwiftUI
import Photos
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Authentic Apple iOS Photos Full-Bleed Single Triage View
/// Provides edge-to-edge photo inspection on OLED black, horizontal swiping to compare photos freely,
/// bottom thumbnail filmstrip scrubber, and standard Apple toolbars with 1-tap auto-advancing triage actions.
public struct SingleTriageView: View {
    @EnvironmentObject public var triageState: TriageState
    @EnvironmentObject public var photoKitManager: PhotoKitManager

    public var onDismissToGrid: (() -> Void)? = nil

    // Image loading state
    @State private var currentImage: UIImage? = nil
    @State private var isLoadingImage = false

    // Zoom, Navigation, and Cancellable Auto-Advance
    @State private var zoomScale: CGFloat = 1.0
    @State private var dragOffset: CGSize = .zero
    @State private var transientDecision: TriageDecision? = nil
    @State private var showDetailsSheet: Bool = false
    @State private var autoAdvanceTask: Task<Void, Never>? = nil

    public init(onDismissToGrid: (() -> Void)? = nil) {
        self.onDismissToGrid = onDismissToGrid
    }

    public var currentAsset: TriageAsset? {
        triageState.currentAsset
    }

    public var currentDecision: TriageDecision {
        guard let asset = currentAsset else { return .unsorted }
        return triageState.decision(for: asset)
    }

    public var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let asset = currentAsset {
                VStack(spacing: 0) {
                    // 1. Standard Top Navigation Bar
                    nativeTopBar

                    // 2. Full-Bleed Photo Viewport
                    photoCanvas(for: asset)

                    // 3. Filmstrip Scrubber & Bottom Toolbar
                    nativeBottomToolbar
                }
            } else {
                emptyStateView
            }
        }
        .task(id: currentAsset?.id) {
            await reloadImage()
        }
        .sheet(isPresented: $showDetailsSheet) {
            if let asset = currentAsset {
                PhotoDetailsSheetView(
                    asset: asset,
                    decision: currentDecision,
                    hardDriveRoot: "/Volumes/PhotosHD"
                )
            }
        }
    }

    // MARK: - Top Navigation Bar

    private var nativeTopBar: some View {
        HStack(spacing: 12) {
            // Back to Grid
            Button {
                triggerHapticFeedback(0)
                onDismissToGrid?()
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 16, weight: .semibold))
                    Text("Photos")
                        .font(.system(size: 16))
                }
                .foregroundColor(.white)
            }

            Spacer()

            // Date & Index Counter
            if let asset = currentAsset {
                VStack(spacing: 1) {
                    Text(formattedDisplayDate(for: asset))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                    Text("\(triageState.currentIndex + 1) of \(triageState.totalCount)")
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.6))
                }
            }

            Spacer()

            // Undo & Info Buttons
            HStack(spacing: 16) {
                Button {
                    triggerHapticFeedback(0)
                    autoAdvanceTask?.cancel()
                    withAnimation {
                        transientDecision = nil
                    }
                    _ = triageState.undo()
                } label: {
                    Image(systemName: "arrow.uturn.backward")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(triageState.canUndo ? .white : .white.opacity(0.25))
                }
                .disabled(!triageState.canUndo)

                Button {
                    triggerHapticFeedback(0)
                    showDetailsSheet = true
                } label: {
                    Image(systemName: "info.circle")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundColor(.white)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color(red: 0.08, green: 0.08, blue: 0.09).opacity(0.92))
        .overlay(
            Rectangle()
                .fill(Color.white.opacity(0.12))
                .frame(height: 0.5),
            alignment: .bottom
        )
    }

    // MARK: - Photo Canvas with Horizontal Paging

    private func photoCanvas(for asset: TriageAsset) -> some View {
        GeometryReader { geometry in
            ZStack {
                Color.black

                if let image = currentImage {
                    Image(platformImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .scaleEffect(zoomScale)
                        .offset(dragOffset)
                        .frame(maxWidth: geometry.size.width, maxHeight: geometry.size.height)
                        .gesture(horizontalSwipeGesture)
                        .simultaneousGesture(magnificationGesture)
                        .onTapGesture(count: 2) {
                            withAnimation(.easeInOut(duration: 0.15)) {
                                zoomScale = (zoomScale > 1.2) ? 1.0 : 2.5
                            }
                        }
                } else if isLoadingImage {
                    ProgressView()
                        .tint(.white)
                } else {
                    VStack(spacing: 8) {
                        Image(systemName: "photo")
                            .font(.system(size: 32))
                            .foregroundColor(.white.opacity(0.3))
                        Text("Preview unavailable")
                            .font(.system(size: 12))
                            .foregroundColor(.white.opacity(0.5))
                    }
                }

                // Transient Feedback Badge on Triage Selection
                if let decision = transientDecision {
                    HStack(spacing: 6) {
                        Image(systemName: decision.iconName)
                        Text(decision.title.uppercased())
                    }
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(decision.color)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(Color.black.opacity(0.85))
                    .cornerRadius(16)
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(decision.color.opacity(0.6), lineWidth: 1))
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
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

    private var horizontalSwipeGesture: some Gesture {
        DragGesture()
            .onChanged { val in
                guard zoomScale <= 1.05 else { return }
                dragOffset = CGSize(width: val.translation.width, height: 0)
            }
            .onEnded { val in
                guard zoomScale <= 1.05 else { return }
                let dx = val.translation.width
                let dy = val.translation.height

                if abs(dx) > 50 && abs(dx) > abs(dy) {
                    autoAdvanceTask?.cancel()
                    withAnimation {
                        transientDecision = nil
                    }
                    if dx < 0 {
                        // Swipe Left: Next Photo
                        triggerHapticFeedback(0)
                        triageState.goToNext()
                    } else {
                        // Swipe Right: Previous Photo
                        triggerHapticFeedback(0)
                        triageState.goToPrevious()
                    }
                } else if dy < -70 && abs(dy) > abs(dx) {
                    // Swipe Up: Open Apple Details Sheet
                    triggerHapticFeedback(0)
                    showDetailsSheet = true
                }

                withAnimation(.easeOut(duration: 0.15)) {
                    dragOffset = .zero
                }
            }
    }

    // MARK: - Bottom Toolbar & Scrubber

    private var nativeBottomToolbar: some View {
        VStack(spacing: 0) {
            // Filmstrip Scrubber
            FilmstripScrubberView()
                .padding(.bottom, 2)

            // 0.5pt Hairline Divider
            Rectangle()
                .fill(Color.white.opacity(0.12))
                .frame(height: 0.5)

            // 5-Item Apple Action Row
            HStack(spacing: 0) {
                // Prev Photo
                Button {
                    triggerHapticFeedback(0)
                    triageState.goToPrevious()
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 17, weight: .medium))
                        Text("Prev")
                            .font(.system(size: 9, weight: .medium))
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundColor(triageState.currentIndex > 0 ? .white : .white.opacity(0.25))
                }
                .disabled(triageState.currentIndex == 0)

                // Trash Action
                Button {
                    applyTriageDecision(.trash)
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: "trash.fill")
                            .font(.system(size: 20, weight: .medium))
                        Text("Trash")
                            .font(.system(size: 10, weight: .medium))
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundColor(.triageTrash)
                }

                // HD Only Action
                Button {
                    applyTriageDecision(.backupOnly)
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: "externaldrive.badge.arrow.down")
                            .font(.system(size: 20, weight: .medium))
                        Text("HD Only")
                            .font(.system(size: 10, weight: .medium))
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundColor(.triageBackupOnly)
                }

                // Keep Action
                Button {
                    applyTriageDecision(.backupKeep)
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: "iphone.badge.checkmark")
                            .font(.system(size: 20, weight: .medium))
                        Text("Keep")
                            .font(.system(size: 10, weight: .medium))
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundColor(.triageBackupKeep)
                }

                // Next Photo
                Button {
                    triggerHapticFeedback(0)
                    triageState.goToNext()
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 17, weight: .medium))
                        Text("Next")
                            .font(.system(size: 9, weight: .medium))
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundColor(triageState.currentIndex < triageState.totalCount - 1 ? .white : .white.opacity(0.25))
                }
                .disabled(triageState.currentIndex >= triageState.totalCount - 1)
            }
            .padding(.top, 10)
            .padding(.bottom, 6)
        }
        .background(Color(red: 0.08, green: 0.08, blue: 0.09).opacity(0.92))
    }

    // MARK: - Decision Handling

    private func applyTriageDecision(_ decision: TriageDecision) {
        triggerHapticFeedback(1)
        autoAdvanceTask?.cancel()

        withAnimation(.easeInOut(duration: 0.15)) {
            transientDecision = decision
        }
        triageState.triageCurrent(as: decision, autoAdvance: false)

        autoAdvanceTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.2)) {
                transientDecision = nil
                triageState.goToNext()
            }
        }
    }

    // MARK: - Helpers

    private func formattedDisplayDate(for asset: TriageAsset) -> String {
        guard let date = asset.creationDate else {
            return asset.formattedDate
        }
        let df = DateFormatter()
        df.dateStyle = .medium
        df.timeStyle = .none
        return df.string(from: date)
    }

    private func reloadImage() async {
        guard let asset = currentAsset else {
            currentImage = nil
            return
        }
        isLoadingImage = true
        zoomScale = 1.0
        dragOffset = .zero

        let loaded = await photoKitManager.loadFullImage(for: asset)
        await MainActor.run {
            self.currentImage = loaded
            self.isLoadingImage = false
        }
    }

    private func triggerHapticFeedback(_ style: Int) {
        #if canImport(UIKit)
        if style == 1 {
            let feedback = UINotificationFeedbackGenerator()
            feedback.notificationOccurred(.success)
        } else {
            let feedback = UIImpactFeedbackGenerator(style: .light)
            feedback.impactOccurred()
        }
        #endif
    }

    private var emptyStateView: some View {
        VStack(spacing: 12) {
            Image(systemName: "photo.stack")
                .font(.system(size: 40))
                .foregroundColor(.white.opacity(0.3))
            Text("No Photos Available")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(.white)
        }
    }
}
