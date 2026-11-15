import SwiftUI
import Photos
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Authentic Apple iOS Photos Full-Bleed Single Triage View
/// Provides edge-to-edge photo inspection on OLED black, horizontal carousel paging where adjacent photos
/// peek into view side-by-side in real time, Instagram-style spring popups for triage decisions,
/// top-right decision status badge, and standard Apple toolbars.
public struct SingleTriageView: View {
    @EnvironmentObject public var triageState: TriageState
    @EnvironmentObject public var photoKitManager: PhotoKitManager

    public var onDismissToGrid: (() -> Void)? = nil

    // Zoom, Carousel Drag, and Cancellable Auto-Advance
    @State private var zoomScale: CGFloat = 1.0
    @State private var dragOffset: CGSize = .zero
    @State private var showDetailsSheet: Bool = false
    @State private var autoAdvanceTask: Task<Void, Never>? = nil

    // Instagram-style spring popup overlay
    @State private var popDecision: TriageDecision? = nil
    @State private var popScale: CGFloat = 0.3
    @State private var popOpacity: Double = 0.0

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

            if let _ = currentAsset {
                VStack(spacing: 0) {
                    // 1. Standard Top Navigation Bar
                    nativeTopBar

                    // 2. Full-Bleed Photo Paging Carousel Viewport
                    carouselTrack

                    // 3. Filmstrip Scrubber & Bottom Toolbar
                    nativeBottomToolbar
                }
            } else {
                emptyStateView
            }
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
        HStack(spacing: 8) {
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
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                    Text("\(triageState.currentIndex + 1) of \(triageState.totalCount)")
                        .font(.system(size: 10))
                        .foregroundColor(.white.opacity(0.6))
                }
            }

            Spacer()

            // Top-Right Decision Badge (Requested by User)
            topRightDecisionBadge

            // Undo & Info Buttons
            HStack(spacing: 12) {
                Button {
                    triggerHapticFeedback(0)
                    autoAdvanceTask?.cancel()
                    popDecision = nil
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
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color(red: 0.08, green: 0.08, blue: 0.09).opacity(0.92))
        .overlay(
            Rectangle()
                .fill(Color.white.opacity(0.12))
                .frame(height: 0.5),
            alignment: .bottom
        )
    }

    // Top-Right Status Badge showing decision color
    private var topRightDecisionBadge: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(decisionDotColor)
                .frame(width: 6, height: 6)
            Text(decisionBadgeText)
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(decisionTextColor)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(decisionBackgroundColor)
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(decisionBorderColor, lineWidth: 0.5)
        )
    }

    private var decisionDotColor: Color {
        switch currentDecision {
        case .trash: return Color.triageTrash
        case .backupOnly: return Color.triageBackupOnly
        case .backupKeep: return Color.triageBackupKeep
        case .unsorted: return Color.white.opacity(0.4)
        }
    }

    private var decisionBadgeText: String {
        switch currentDecision {
        case .trash: return "TRASH"
        case .backupOnly: return "HD ONLY"
        case .backupKeep: return "KEEP"
        case .unsorted: return "UNSORTED"
        }
    }

    private var decisionTextColor: Color {
        switch currentDecision {
        case .trash: return Color.red.opacity(0.9)
        case .backupOnly: return Color.blue.opacity(0.9)
        case .backupKeep: return Color.green.opacity(0.9)
        case .unsorted: return Color.white.opacity(0.6)
        }
    }

    private var decisionBackgroundColor: Color {
        switch currentDecision {
        case .trash: return Color.red.opacity(0.15)
        case .backupOnly: return Color.blue.opacity(0.15)
        case .backupKeep: return Color.green.opacity(0.15)
        case .unsorted: return Color.white.opacity(0.08)
        }
    }

    private var decisionBorderColor: Color {
        switch currentDecision {
        case .trash: return Color.red.opacity(0.4)
        case .backupOnly: return Color.blue.opacity(0.4)
        case .backupKeep: return Color.green.opacity(0.4)
        case .unsorted: return Color.white.opacity(0.12)
        }
    }

    // MARK: - Photo Canvas with Carousel & Instagram Spring Popups

    private var carouselTrack: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let height = geometry.size.height
            let slideSize = CGSize(width: width, height: height)

            ZStack {
                Color.black

                // 3-Panel Balanced Carousel Track: [Slot 0 (prev), Slot 1 (current), Slot 2 (next)]
                // Because Slot 1 is ALWAYS the exact center child of the 3-panel HStack,
                // it is naturally centered in the viewport with baseOffset = 0!
                HStack(spacing: 16) {
                    // Slot 0: Previous asset or empty placeholder
                    if triageState.currentIndex > 0 {
                        AssetSlideView(
                            asset: triageState.assets[triageState.currentIndex - 1],
                            size: slideSize
                        )
                    } else {
                        Color.clear.frame(width: width, height: height)
                    }

                    // Slot 1: Current asset (ALWAYS centered)
                    AssetSlideView(
                        asset: currentAsset,
                        size: slideSize,
                        isCenter: true,
                        zoomScale: zoomScale,
                        verticalOffset: dragOffset.height
                    )

                    // Slot 2: Next asset or empty placeholder
                    if triageState.currentIndex < triageState.totalCount - 1 {
                        AssetSlideView(
                            asset: triageState.assets[triageState.currentIndex + 1],
                            size: slideSize
                        )
                    } else {
                        Color.clear.frame(width: width, height: height)
                    }
                }
                .offset(x: dragOffset.width)
                .gesture(horizontalSwipeGesture)
                .simultaneousGesture(magnificationGesture)
                .onTapGesture(count: 2) {
                    // Double-tap: Reset zoom if zoomed in, otherwise trigger Keep (Instagram pop)
                    if zoomScale > 1.05 {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            zoomScale = 1.0
                        }
                    } else {
                        applyTriageDecision(.backupKeep)
                    }
                }

                // Instagram-style spring popup overlay in center
                if let decision = popDecision {
                    instagramPopOverlay(decision: decision)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
        }
    }

    // Instagram-style Spring Pop Overlay
    private func instagramPopOverlay(decision: TriageDecision) -> some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(decisionBadgeColor(for: decision).opacity(0.92))
                    .frame(width: 80, height: 80)
                    .shadow(color: decisionBadgeColor(for: decision).opacity(0.5), radius: 16, x: 0, y: 6)
                Image(systemName: decisionPopIcon(for: decision))
                    .font(.system(size: 38, weight: .bold))
                    .foregroundColor(.white)
            }
            Text(decisionPopLabel(for: decision))
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(.white)
                .shadow(color: .black.opacity(0.8), radius: 4, x: 0, y: 2)
        }
        .scaleEffect(popScale)
        .opacity(popOpacity)
        .allowsHitTesting(false)
    }

    private func decisionBadgeColor(for decision: TriageDecision) -> Color {
        switch decision {
        case .trash: return Color.triageTrash
        case .backupOnly: return Color.triageBackupOnly
        case .backupKeep: return Color.triageBackupKeep
        case .unsorted: return Color.white.opacity(0.4)
        }
    }

    private func decisionPopIcon(for decision: TriageDecision) -> String {
        switch decision {
        case .trash: return "trash.fill"
        case .backupOnly: return "externaldrive.badge.arrow.down"
        case .backupKeep: return "checkmark"
        case .unsorted: return "questionmark"
        }
    }

    private func decisionPopLabel(for decision: TriageDecision) -> String {
        switch decision {
        case .trash: return "Delete from Phone"
        case .backupOnly: return "HD Only (Offload)"
        case .backupKeep: return "Keep on Phone"
        case .unsorted: return "Unsorted"
        }
    }

    // MARK: - Gestures

    private var magnificationGesture: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                zoomScale = max(1.0, min(value, 4.0))
            }
            .onEnded { _ in
                if zoomScale < 1.05 {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        zoomScale = 1.0
                    }
                }
            }
    }

    private var horizontalSwipeGesture: some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .local)
            .onChanged { value in
                guard zoomScale <= 1.05 else { return }

                let dx = value.translation.width
                let dy = value.translation.height

                // If horizontal drag dominates, track finger 1:1 with carousel offset
                if abs(dx) > abs(dy) {
                    var offset = dx
                    // Rubber banding resistance at boundaries
                    if (triageState.currentIndex == 0 && dx > 0) ||
                       (triageState.currentIndex == triageState.totalCount - 1 && dx < 0) {
                        offset = dx * 0.35
                    }
                    dragOffset = CGSize(width: offset, height: 0)
                } else {
                    // Vertical drag tracking for triage flick
                    dragOffset = CGSize(width: 0, height: dy * 0.6)
                }
            }
            .onEnded { value in
                guard zoomScale <= 1.05 else { return }

                let dx = value.translation.width
                let dy = value.translation.height

                // Vertical Dominant Gesture (Swipe Down = Trash, Swipe Up = HD Only)
                if abs(dy) > 55 && abs(dy) > abs(dx) * 1.3 {
                    withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                        dragOffset = .zero
                    }
                    if dy > 55 {
                        applyTriageDecision(.trash)
                    } else if dy < -55 {
                        applyTriageDecision(.backupOnly)
                    }
                    return
                }

                // Horizontal Carousel Paging
                let threshold: CGFloat = 60
                if dx < -threshold && triageState.currentIndex < triageState.totalCount - 1 {
                    // Dragged left -> advance to next photo
                    withAnimation(.easeOut(duration: 0.2)) {
                        dragOffset = .zero
                        triageState.goToNext()
                    }
                } else if dx > threshold && triageState.currentIndex > 0 {
                    // Dragged right -> go back to previous photo
                    withAnimation(.easeOut(duration: 0.2)) {
                        dragOffset = .zero
                        triageState.goToPrevious()
                    }
                } else {
                    // Snap back smoothly
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                        dragOffset = .zero
                    }
                }
            }
    }

    // MARK: - Filmstrip & Bottom Action Toolbar

    private var nativeBottomToolbar: some View {
        VStack(spacing: 0) {
            // Filmstrip Scrubber
            FilmstripScrubberView()
                .frame(height: 72)

            // Standard Apple Triage Action Bar
            HStack(spacing: 0) {
                // Previous
                Button {
                    triggerHapticFeedback(0)
                    autoAdvanceTask?.cancel()
                    popDecision = nil
                    withAnimation(.easeOut(duration: 0.2)) {
                        triageState.goToPrevious()
                    }
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
                .disabled(triageState.currentIndex <= 0)

                // Trash
                Button {
                    applyTriageDecision(.trash)
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: "trash.fill")
                            .font(.system(size: 20))
                        Text("Trash")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundColor(Color.triageTrash)
                }

                // HD Only
                Button {
                    applyTriageDecision(.backupOnly)
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: "externaldrive.badge.arrow.down")
                            .font(.system(size: 20))
                        Text("HD Only")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundColor(Color.triageBackupOnly)
                }

                // Keep
                Button {
                    applyTriageDecision(.backupKeep)
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: "iphone.badge.checkmark")
                            .font(.system(size: 20, weight: .bold))
                        Text("Keep")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundColor(Color.triageBackupKeep)
                }

                // Next
                Button {
                    triggerHapticFeedback(0)
                    autoAdvanceTask?.cancel()
                    popDecision = nil
                    withAnimation(.easeOut(duration: 0.2)) {
                        triageState.goToNext()
                    }
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

    // MARK: - Decision Handling with Instagram Spring Pop

    private func applyTriageDecision(_ decision: TriageDecision) {
        triggerHapticFeedback(1)
        autoAdvanceTask?.cancel()

        popDecision = decision
        popScale = 0.3
        popOpacity = 0.0

        withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) {
            popScale = 1.2
            popOpacity = 1.0
        }

        triageState.triageCurrent(as: decision, autoAdvance: false)

        autoAdvanceTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 220_000_000)
            withAnimation(.easeOut(duration: 0.15)) {
                popScale = 1.0
                popOpacity = 0.0
            }
            try? await Task.sleep(nanoseconds: 130_000_000)
            guard !Task.isCancelled else { return }
            popDecision = nil
            withAnimation(.easeOut(duration: 0.25)) {
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

/// Individual slide in the carousel, loading and caching its asset image asynchronously
public struct AssetSlideView: View {
    @EnvironmentObject public var photoKitManager: PhotoKitManager
    public let asset: TriageAsset?
    public let size: CGSize
    public var isCenter: Bool = false
    public var zoomScale: CGFloat = 1.0
    public var verticalOffset: CGFloat = 0.0

    @State private var slideImage: UIImage? = nil
    @State private var isLoading: Bool = false

    public init(asset: TriageAsset?, size: CGSize, isCenter: Bool = false, zoomScale: CGFloat = 1.0, verticalOffset: CGFloat = 0.0) {
        self.asset = asset
        self.size = size
        self.isCenter = isCenter
        self.zoomScale = zoomScale
        self.verticalOffset = verticalOffset
    }

    public var body: some View {
        ZStack {
            Color.black
            if let img = slideImage {
                Image(platformImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: size.width, height: size.height)
                    .scaleEffect(isCenter ? zoomScale : 1.0)
                    .offset(y: isCenter ? verticalOffset : 0)
            } else if asset != nil {
                ProgressView().tint(.white)
            }
        }
        .frame(width: size.width, height: size.height)
        .clipped()
        .task(id: asset?.id) {
            guard let asset = asset else {
                slideImage = nil
                return
            }
            isLoading = true
            let loaded = await photoKitManager.loadThumbnail(for: asset, size: CGSize(width: size.width * 2, height: size.height * 2))
            await MainActor.run {
                self.slideImage = loaded
                self.isLoading = false
            }
        }
    }
}
