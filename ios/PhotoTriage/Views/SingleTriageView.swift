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

    // Image loading state (current + adjacent slides for smooth 60fps peeking)
    @State private var currentImage: UIImage? = nil
    @State private var prevImage: UIImage? = nil
    @State private var nextImage: UIImage? = nil
    @State private var isLoadingImage = false

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

            if let asset = currentAsset {
                VStack(spacing: 0) {
                    // 1. Standard Top Navigation Bar
                    nativeTopBar

                    // 2. Full-Bleed Photo Paging Carousel Viewport
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
        case .trash: return "Trash"
        case .backupOnly: return "HD Only"
        case .backupKeep: return "Keep"
        case .unsorted: return "Unsorted"
        }
    }

    private var decisionTextColor: Color {
        switch currentDecision {
        case .trash: return Color.red.opacity(0.9)
        case .backupOnly: return Color.blue.opacity(0.9)
        case .backupKeep: return Color.green.opacity(0.9)
        case .unsorted: return Color.white.opacity(0.5)
        }
    }

    private var decisionBackgroundColor: Color {
        switch currentDecision {
        case .trash: return Color.red.opacity(0.18)
        case .backupOnly: return Color.blue.opacity(0.18)
        case .backupKeep: return Color.green.opacity(0.18)
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

    private func photoCanvas(for asset: TriageAsset) -> some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let height = geometry.size.height

            ZStack {
                Color.black

                // Interactive Continuous Paging Carousel Track
                HStack(spacing: 16) {
                    if triageState.currentIndex > 0 {
                        carouselSlide(image: prevImage, size: CGSize(width: width, height: height))
                    }

                    carouselSlide(image: currentImage, size: CGSize(width: width, height: height))
                        .scaleEffect(zoomScale)

                    if triageState.currentIndex < triageState.totalCount - 1 {
                        carouselSlide(image: nextImage, size: CGSize(width: width, height: height))
                    }
                }
                .offset(x: carouselOffset(width: width))
                .gesture(horizontalSwipeGesture)
                .simultaneousGesture(magnificationGesture)
                .onTapGesture(count: 2) {
                    // Double-tap to Keep on Phone (Instagram heart-pop style)
                    applyTriageDecision(.backupKeep)
                }

                if isLoadingImage && currentImage == nil {
                    ProgressView().tint(.white)
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

    private func carouselOffset(width: CGFloat) -> CGFloat {
        let baseOffset = (triageState.currentIndex > 0) ? -(width + 16) : 0
        return baseOffset + dragOffset.width
    }

    private func carouselSlide(image: UIImage?, size: CGSize) -> some View {
        ZStack {
            Color.black
            if let img = image {
                Image(platformImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: size.width, height: size.height)
                    .offset(y: dragOffset.height)
            } else {
                ProgressView().tint(.white)
            }
        }
        .frame(width: size.width, height: size.height)
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
        .zIndex(50)
    }

    private func decisionBadgeColor(for decision: TriageDecision) -> Color {
        switch decision {
        case .trash: return Color.triageTrash
        case .backupOnly: return Color.triageBackupOnly
        case .backupKeep: return Color.triageBackupKeep
        case .unsorted: return Color.slate500
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
        case .trash: return "TRASH"
        case .backupOnly: return "HD ONLY"
        case .backupKeep: return "KEEP ON PHONE"
        case .unsorted: return "UNSORTED"
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
                let dx = val.translation.width
                let dy = val.translation.height

                if abs(dx) > abs(dy) {
                    var horizontalShift = dx
                    if (triageState.currentIndex == 0 && dx > 0) ||
                       (triageState.currentIndex >= triageState.totalCount - 1 && dx < 0) {
                        horizontalShift = dx * 0.35
                    }
                    dragOffset = CGSize(width: horizontalShift, height: 0)
                } else {
                    dragOffset = CGSize(width: 0, height: dy * 0.5)
                }
            }
            .onEnded { val in
                guard zoomScale <= 1.05 else { return }
                let dx = val.translation.width
                let dy = val.translation.height

                // Vertical gestures: Swipe Down = Trash, Swipe Up = HD Only
                if abs(dy) > 55 && abs(dy) > abs(dx) * 1.3 {
                    withAnimation(.easeOut(duration: 0.15)) {
                        dragOffset = .zero
                    }
                    if dy > 55 {
                        // Swipe DOWN: Trash!
                        applyTriageDecision(.trash)
                    } else if dy < -55 {
                        // Swipe UP: HD Only!
                        applyTriageDecision(.backupOnly)
                    }
                    return
                }

                // Horizontal carousel snap
                if abs(dx) > 60 {
                    autoAdvanceTask?.cancel()
                    if dx < 0 && triageState.currentIndex < triageState.totalCount - 1 {
                        withAnimation(.easeOut(duration: 0.2)) {
                            triageState.goToNext()
                            dragOffset = .zero
                        }
                    } else if dx > 0 && triageState.currentIndex > 0 {
                        withAnimation(.easeOut(duration: 0.2)) {
                            triageState.goToPrevious()
                            dragOffset = .zero
                        }
                    } else {
                        withAnimation(.easeOut(duration: 0.2)) {
                            dragOffset = .zero
                        }
                    }
                } else {
                    withAnimation(.easeOut(duration: 0.2)) {
                        dragOffset = .zero
                    }
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
            triageState.goToNext()
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
            prevImage = nil
            nextImage = nil
            return
        }
        isLoadingImage = true
        dragOffset = .zero

        let loaded = await photoKitManager.loadFullImage(for: asset)

        // Preload adjacent cached thumbnails for 60fps peeking
        var prevLoaded: UIImage? = nil
        var nextLoaded: UIImage? = nil
        let idx = triageState.currentIndex
        if idx > 0 && idx - 1 < triageState.assets.count {
            prevLoaded = await photoKitManager.loadThumbnail(for: triageState.assets[idx - 1])
        }
        if idx + 1 < triageState.assets.count {
            nextLoaded = await photoKitManager.loadThumbnail(for: triageState.assets[idx + 1])
        }

        await MainActor.run {
            self.currentImage = loaded
            self.prevImage = prevLoaded
            self.nextImage = nextLoaded
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
