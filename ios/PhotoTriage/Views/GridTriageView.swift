import SwiftUI
import Photos
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Represents a calendar day grouping of triage assets.
public struct DailyAssetSection: Identifiable, Sendable, Equatable {
    public let id: String
    public let date: Date
    public let title: String
    public let assets: [TriageAsset]

    public init(id: String, date: Date, title: String, assets: [TriageAsset]) {
        self.id = id
        self.date = date
        self.title = title
        self.assets = assets
    }
}

/// Utilitarian Grid Triage View
/// Provides a high-density thumbnail grid with status badges, category filtering,
/// and batch multi-selection for bulk triage operations.
public struct GridTriageView: View {
    @EnvironmentObject public var triageState: TriageState
    @EnvironmentObject public var photoKitManager: PhotoKitManager

    public var onAssetSelected: ((TriageAsset) -> Void)?

    @State private var currentFilter: TriageFilter = .all
    @State private var isSelectMode: Bool = false
    @State private var selectedAssetIds: Set<String> = []

    @AppStorage("isAdvancedModeEnabled") private var isAdvancedModeEnabled: Bool = false

    private let columns = [
        GridItem(.adaptive(minimum: 104, maximum: 128), spacing: 2)
    ]

    private static let dayHeaderFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMM d, yyyy"
        return formatter
    }()

    public init(onAssetSelected: ((TriageAsset) -> Void)? = nil) {
        self.onAssetSelected = onAssetSelected
    }

    public var displayAssets: [TriageAsset] {
        triageState.filteredAssets(filter: currentFilter)
    }

    public func groupedDailySections(for assets: [TriageAsset]) -> [DailyAssetSection] {
        guard !assets.isEmpty else { return [] }

        let calendar = Calendar.current
        let fallbackDate = Date()
        var dict: [Date: [TriageAsset]] = [:]
        var orderedDays: [Date] = []

        for asset in assets {
            let dayDate = calendar.startOfDay(for: asset.creationDate ?? fallbackDate)
            if dict[dayDate] == nil {
                orderedDays.append(dayDate)
            }
            dict[dayDate, default: []].append(asset)
        }

        return orderedDays.compactMap { dayDate in
            guard let dayAssets = dict[dayDate], !dayAssets.isEmpty else { return nil }
            let id = String(Int(dayDate.timeIntervalSince1970))
            let title = Self.dayHeaderFormatter.string(from: dayDate)
            return DailyAssetSection(id: id, date: dayDate, title: title, assets: dayAssets)
        }
    }

    public var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Apple Header & Category Filter Bar
                filterHeaderBar

                // Thumbnail Grid
                if triageState.assets.isEmpty {
                    emptyBatchView
                } else if displayAssets.isEmpty {
                    emptyFilterView
                } else {
                    assetGridScrollView
                }

                // Bottom Floating Bulk Action Bar (when in select mode)
                if isSelectMode {
                    bulkActionBar
                }
            }
        }
    }

    // MARK: - Header & Filter Bar

    private var filterHeaderBar: some View {
        VStack(spacing: 8) {
            // Mode & Select Toggle Row
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Text("\(triageState.selectedMonth?.displayName ?? "NO BATCH")")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(.white)
                }

                Spacer()

                // Live Storage Reclaimed Counter
                if triageState.estimatedBytesReclaimedOnPhone > 0 {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.down.circle.fill")
                            .font(.system(size: 11, weight: .semibold))
                        Text("Freed \(triageState.formattedBytesReclaimedOnPhone)")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundColor(.blue)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.blue.opacity(0.15))
                    .clipShape(Capsule())
                }

                if !triageState.assets.isEmpty {
                    // 1-Tap Info Mode Toggle
                    Button {
                        triggerHapticFeedback(0)
                        isAdvancedModeEnabled.toggle()
                    } label: {
                        Image(systemName: isAdvancedModeEnabled ? "info.circle.fill" : "info.circle")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(isAdvancedModeEnabled ? .blue : .white.opacity(0.7))
                            .padding(6)
                            .background(Color.white.opacity(0.1))
                            .clipShape(Circle())
                    }

                    Button {
                        triggerHapticFeedback(0)
                        withAnimation(.easeInOut(duration: 0.2)) {
                            isSelectMode.toggle()
                            if !isSelectMode {
                                selectedAssetIds.removeAll()
                            }
                        }
                    } label: {
                        Text(isSelectMode ? "Done" : "Select")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.blue)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color.white.opacity(0.1))
                            .clipShape(Capsule())
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)

            // Segmented Filter Bar (Apple Capsule Style)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(TriageFilter.allCases) { filter in
                        filterTabButton(filter: filter)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }

            Rectangle()
                .fill(Color.white.opacity(0.12))
                .frame(height: 0.5)
        }
        .background(Color(red: 0.08, green: 0.08, blue: 0.09).opacity(0.95))
    }

    private func filterTabButton(filter: TriageFilter) -> some View {
        let isSelected = (currentFilter == filter)
        let count = count(for: filter)

        return Button {
            triggerHapticFeedback(0)
            currentFilter = filter
        } label: {
            HStack(spacing: 4) {
                Text(filter.rawValue)
                    .font(.system(size: 12, weight: isSelected ? .semibold : .medium))

                Text("\(count)")
                    .font(.system(size: 11, weight: .regular))
                    .foregroundColor(isSelected ? .white.opacity(0.8) : .white.opacity(0.4))
            }
            .foregroundColor(isSelected ? .white : .white.opacity(0.7))
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(isSelected ? Color.blue : Color.white.opacity(0.1))
            .clipShape(Capsule())
        }
    }

    private func count(for filter: TriageFilter) -> Int {
        switch filter {
        case .all:
            return triageState.totalCount
        case .unsorted:
            return triageState.unsortedCount
        case .trash:
            return triageState.trashCount
        case .backupOnly:
            return triageState.backupOnlyCount
        case .backupKeep:
            return triageState.backupKeepCount
        }
    }

    // MARK: - Asset Grid

    private var assetGridScrollView: some View {
        let dailySections = groupedDailySections(for: displayAssets)

        return ScrollView {
            LazyVGrid(columns: columns, spacing: 4, pinnedViews: [.sectionHeaders]) {
                ForEach(dailySections) { section in
                    Section(header: DaySectionHeader(title: section.title, count: section.assets.count)) {
                        ForEach(section.assets) { asset in
                            let decision = triageState.decision(for: asset)
                            let isSelected = selectedAssetIds.contains(asset.id)

                            GridThumbnailCell(
                                asset: asset,
                                decision: decision,
                                isSelectMode: isSelectMode,
                                isSelected: isSelected
                            )
                            .onTapGesture {
                                if isSelectMode {
                                    toggleSelection(for: asset)
                                } else {
                                    triageState.selectAsset(asset)
                                    onAssetSelected?(asset)
                                }
                            }
                        }
                    }
                }
            }
            .padding(6)
        }
    }

    private func toggleSelection(for asset: TriageAsset) {
        if selectedAssetIds.contains(asset.id) {
            selectedAssetIds.remove(asset.id)
        } else {
            selectedAssetIds.insert(asset.id)
        }
    }

    // MARK: - Bulk Action Bar

    private var bulkActionBar: some View {
        VStack(spacing: 8) {
            // Select All / Deselect All Row
            HStack {
                Text("\(selectedAssetIds.count) of \(displayAssets.count) Selected")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)

                Spacer()

                Button {
                    if selectedAssetIds.count == displayAssets.count {
                        selectedAssetIds.removeAll()
                    } else {
                        selectedAssetIds = Set(displayAssets.map { $0.id })
                    }
                } label: {
                    Text(selectedAssetIds.count == displayAssets.count ? "DESELECT ALL" : "SELECT ALL")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.blue)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)

            // Bulk Assignment Buttons
            HStack(spacing: 8) {
                bulkButton(icon: "trash.fill", title: "Trash", decision: .trash, color: .triageTrash)
                bulkButton(icon: "externaldrive.fill", title: "HD Only", decision: .backupOnly, color: .triageBackupOnly)
                bulkButton(icon: "iphone.badge.checkmark", title: "Keep", decision: .backupKeep, color: .triageBackupKeep)
                bulkButton(icon: "arrow.uturn.backward", title: "Reset", decision: .unsorted, color: .white.opacity(0.6))
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 10)
        }
        .background(Color(red: 0.12, green: 0.12, blue: 0.14).opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.white.opacity(0.15), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.6), radius: 12, y: 4)
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
    }

    private func bulkButton(icon: String, title: String, decision: TriageDecision, color: Color) -> some View {
        Button {
            triggerHapticFeedback(1)
            for id in selectedAssetIds {
                triageState.setDecision(assetId: id, decision: decision)
            }
            selectedAssetIds.removeAll()
            isSelectMode = false
        } label: {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .bold))
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundColor(color)
            .frame(maxWidth: .infinity)
            .frame(height: 38)
            .background(color.opacity(0.16))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .disabled(selectedAssetIds.isEmpty)
        .opacity(selectedAssetIds.isEmpty ? 0.35 : 1.0)
    }

    // MARK: - Empty States

    private var emptyBatchView: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "square.grid.2x2")
                .font(.system(size: 36))
                .foregroundColor(.slate600)
            Text("NO BATCH LOADED")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundColor(.slate200)
            Text("Select a month to inspect thumbnails.")
                .font(.system(size: 12, design: .rounded))
                .foregroundColor(.slate400)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyFilterView: some View {
        VStack(spacing: 12) {
            Spacer()
            Text("NO ITEMS IN '\(currentFilter.rawValue.uppercased())'")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundColor(.slate300)
            Text("Change filter category above to view other assets.")
                .font(.system(size: 12, design: .rounded))
                .foregroundColor(.slate500)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Grid Thumbnail Cell

public struct GridThumbnailCell: View {
    public let asset: TriageAsset
    public let decision: TriageDecision
    public let isSelectMode: Bool
    public let isSelected: Bool

    @State private var thumbnail: UIImage? = nil
    @AppStorage("isAdvancedModeEnabled") private var isAdvancedMode: Bool = false

    public init(
        asset: TriageAsset,
        decision: TriageDecision,
        isSelectMode: Bool,
        isSelected: Bool
    ) {
        self.asset = asset
        self.decision = decision
        self.isSelectMode = isSelectMode
        self.isSelected = isSelected
    }

    public var body: some View {
        let displayImage = thumbnail ?? PhotoKitManager.shared.cachedThumbnail(for: asset)

        ZStack(alignment: .topTrailing) {
            // Thumbnail Image Canvas
            ZStack {
                Color(red: 0.12, green: 0.12, blue: 0.14)

                if let image = displayImage {
                    Image(platformImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    ProgressView()
                        .scaleEffect(0.6)
                        .tint(.white.opacity(0.4))
                }
            }
            .frame(height: 110)
            .clipped()

            // Status Badge Overlay (Apple Photos Style)
            VStack {
                Spacer()
                HStack(spacing: 3) {
                    if decision != .unsorted {
                        HStack(spacing: 3) {
                            Image(systemName: decision.iconName)
                                .font(.system(size: 8, weight: .bold))
                            Text(decision.shortTitle)
                                .font(.system(size: 9, weight: .semibold))
                        }
                        .foregroundColor(.white)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2.5)
                        .background(decision.color.opacity(0.92))
                        .clipShape(Capsule())
                        .shadow(color: .black.opacity(0.4), radius: 2)
                    }

                    Spacer()

                    if asset.isVideo {
                        Text(asset.formattedDuration ?? "VID")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 2)
                            .background(Color.black.opacity(0.65))
                            .cornerRadius(3)
                    } else if isAdvancedMode, let size = asset.formattedSize as String?, size != "--" {
                        Text(size)
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(.white.opacity(0.9))
                            .padding(.horizontal, 4)
                            .padding(.vertical, 2)
                            .background(Color.black.opacity(0.65))
                            .cornerRadius(3)
                    }
                }
                .padding(4)
            }

            // Selection Checkmark (in Multi-select mode)
            if isSelectMode {
                ZStack {
                    Circle()
                        .fill(isSelected ? Color.blue : Color.black.opacity(0.4))
                        .frame(width: 22, height: 22)
                        .overlay(
                            Circle()
                                .stroke(Color.white, lineWidth: 1.5)
                        )

                    if isSelected {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.white)
                    }
                }
                .padding(6)
            }
        }
        .task(id: asset.id) {
            if let cached = PhotoKitManager.shared.cachedThumbnail(for: asset) {
                thumbnail = cached
                return
            }
            let img = await PhotoKitManager.shared.loadThumbnail(for: asset)
            thumbnail = img
        }
    }
}

/// Sticky Section Header displaying the capture date and asset count for daily grouping.
public struct DaySectionHeader: View {
    public let title: String
    public let count: Int

    public init(title: String, count: Int) {
        self.title = title
        self.count = count
    }

    public var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "calendar")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.blue)

            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(.white)

            Spacer()

            Text("\(count) \(count == 1 ? "Photo" : "Photos")")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.white.opacity(0.5))
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(Color.black.opacity(0.88))
    }
}
